// api/bot.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];
const BASE_URL = process.env.BASE_URL; // e.g. https://your-project.vercel.app

// ===== TELEGRAM BOT (WEBHOOK MODE) =====
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${BASE_URL}/api/bot`);

// ===== GLOBAL ERROR HANDLER =====
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ===== IN-MEMORY DATABASE =====
const users = new Map();
const products = new Map();
const userStates = new Map();
let productIdCounter = 1;

// ===== CATEGORIES =====
const CATEGORIES = [
  'Academic Books','Electronics','Clothes & Fashion','Furniture & Home',
  'Study Materials','Entertainment','Food & Drinks','Transportation',
  'Accessories','Others'
];

// ===== MAINTENANCE MODE =====
let maintenanceMode = false;
const checkMaintenanceMode = (chatId) => {
  if (maintenanceMode) {
    bot.sendMessage(chatId,
      `*Maintenance in Progress*\nWe're improving the marketplace. Back soon!`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }
  return false;
};

// ===== HELPER: MAIN MENU =====
const showMainMenu = (chatId) => {
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: 'Browse Products' }, { text: 'Sell Item' }],
        [{ text: 'My Products' }, { text: 'Contact Admin' }],
        [{ text: 'Help' }]
      ],
      resize_keyboard: true
    }
  };
  bot.sendMessage(chatId, `*JU Marketplace*\nChoose an option:`, { parse_mode: 'Markdown', ...options });
};

// ===== EXPRESS ROOT =====
app.get('/', (req, res) => {
  res.send('JU Marketplace Bot is alive!');
});

// ===== TELEGRAM UPDATE HANDLER =====
app.post(`/bot`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== START COMMAND =====
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (checkMaintenanceMode(chatId)) return;

  if (!users.has(userId)) {
    users.set(userId, {
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name,
      joinedAt: new Date(),
      department: '',
      year: ''
    });
  }

  await bot.sendMessage(chatId,
    `*Welcome to JU Marketplace!*\nBuy & Sell within JU Community.`,
    { parse_mode: 'Markdown' }
  );
  showMainMenu(chatId);
});

// ===== BROWSE PRODUCTS =====
bot.onText(/\/browse|Browse Products/, async (msg) => {
  const chatId = msg.chat.id;
  if (checkMaintenanceMode(chatId)) return;

  const approvedProducts = Array.from(products.values()).filter(p => p.status === 'approved').slice(0, 10);
  if (!approvedProducts.length) {
    await bot.sendMessage(chatId, `No products yet. Use "Sell Item" to add one.`, { parse_mode: 'Markdown' });
    return;
  }

  for (const product of approvedProducts) {
    const seller = users.get(product.sellerId);
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buy Now', callback_data: `buy_${product.id}` }],
          [{ text: 'View Details', callback_data: `details_${product.id}` }]
        ]
      }
    };
    try {
      await bot.sendPhoto(chatId, product.images[0], {
        caption: `*${product.title}*\nPrice: ${product.price} ETB\nSeller: ${seller?.firstName}`,
        parse_mode: 'Markdown', ...keyboard
      });
    } catch {
      await bot.sendMessage(chatId, `*${product.title}*\nPrice: ${product.price} ETB`, { parse_mode: 'Markdown', ...keyboard });
    }
    await new Promise(r => setTimeout(r, 300));
  }
});

// ===== SELL ITEM =====
bot.onText(/\/sell|Sell Item/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (checkMaintenanceMode(chatId)) return;

  userStates.set(userId, { state: 'awaiting_product_images', productData: {} });
  await bot.sendMessage(chatId, `*Step 1/5: Send 1-5 photos*`, { parse_mode: 'Markdown' });
});

// ===== PHOTO HANDLER =====
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userState = userStates.get(userId);
  if (!userState || userState.state !== 'awaiting_product_images') return;

  const photo = msg.photo[msg.photo.length - 1];
  if (!userState.productData.images) userState.productData.images = [];
  userState.productData.images.push(photo.file_id);

  if (userState.productData.images.length >= 1) {
    await bot.sendMessage(chatId, `Photo received! Type *next* or send more photos.`, { parse_mode: 'Markdown' });
  }
  if (userState.productData.images.length >= 5) {
    userState.state = 'awaiting_product_title';
    await bot.sendMessage(chatId, `*Step 2/5: Enter product title*`, { parse_mode: 'Markdown' });
  }
});

// ===== TEXT HANDLER =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const userState = userStates.get(userId);
  if (!userState) return;

  // NEXT TO TITLE
  if (userState.state === 'awaiting_product_images' && text.toLowerCase() === 'next' && userState.productData.images?.length) {
    userState.state = 'awaiting_product_title';
    await bot.sendMessage(chatId, `*Step 2/5: Enter product title*`, { parse_mode: 'Markdown' });
    return;
  }

  // TITLE
  if (userState.state === 'awaiting_product_title') {
    userState.productData.title = text;
    userState.state = 'awaiting_product_price';
    await bot.sendMessage(chatId, `*Step 3/5: Enter price in ETB*`, { parse_mode: 'Markdown' });
    return;
  }

  // PRICE
  if (userState.state === 'awaiting_product_price') {
    if (!isNaN(text) && parseInt(text) > 0) {
      userState.productData.price = parseInt(text);
      userState.state = 'awaiting_product_description';
      await bot.sendMessage(chatId, `*Step 4/5: Description (optional)*\nType /skip to skip`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, 'Invalid price. Use numbers only.');
    }
    return;
  }

  // DESCRIPTION
  if (userState.state === 'awaiting_product_description') {
    userState.productData.description = text === '/skip' ? '' : text;
    await selectProductCategory(chatId, userId, userState);
    return;
  }
});

// ===== CATEGORY SELECTION =====
async function selectProductCategory(chatId, userId, userState) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...CATEGORIES.map(c => [{ text: c, callback_data: `category_${c}` }]),
        [{ text: 'Cancel', callback_data: 'cancel_product' }]
      ]
    }
  };
  userState.state = 'awaiting_product_category';
  userStates.set(userId, userState);
  await bot.sendMessage(chatId, `*Step 5/5: Select Category*`, { parse_mode: 'Markdown', ...keyboard });
}

// ===== CALLBACK HANDLER =====
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (data.startsWith('category_')) {
    const category = data.replace('category_', '');
    const state = userStates.get(userId);
    if (state?.state === 'awaiting_product_category') {
      await completeProductCreation(chatId, userId, state, category, callbackQuery.id);
    }
  }

  if (data === 'cancel_product') {
    userStates.delete(userId);
    await bot.sendMessage(chatId, 'Product creation cancelled.');
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled' });
  }
});

// ===== COMPLETE PRODUCT CREATION =====
async function completeProductCreation(chatId, userId, userState, category, cbId) {
  const user = users.get(userId);
  const product = {
    id: productIdCounter++,
    sellerId: userId,
    sellerUsername: user.username || '',
    title: userState.productData.title,
    description: userState.productData.description || '',
    price: userState.productData.price,
    category,
    images: userState.productData.images,
    status: 'pending',
    createdAt: new Date()
  };
  products.set(product.id, product);
  userStates.delete(userId);

  await notifyAdminsAboutNewProduct(product);
  await bot.answerCallbackQuery(cbId, { text: 'Submitted for approval!' });
  await bot.sendMessage(chatId, `*Product Submitted!*\nStatus: Pending Approval`, { parse_mode: 'Markdown' });
}

// ===== NOTIFY ADMINS =====
async function notifyAdminsAboutNewProduct(product) {
  const seller = users.get(product.sellerId);
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.sendMessage(adminId, `*NEW PRODUCT*\nTitle: ${product.title}\nPrice: ${product.price} ETB\nSeller: ${seller.firstName}`, { parse_mode: 'Markdown' });
    } catch {}
  }
}

// ===== EXPORT APP =====
module.exports = app;
