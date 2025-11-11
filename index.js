const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
require('dotenv').config();

// GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.get('/', (req, res) => {
  res.send('JU Marketplace Bot is alive!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.log('JU Marketplace Bot started!');

// DATABASE (In-Memory)
const users = new Map();
const products = new Map();
const userStates = new Map();
let productIdCounter = 1;

// Categories
const CATEGORIES = [
  'Academic Books',
  'Electronics',
  'Clothes & Fashion',
  'Furniture & Home',
  'Study Materials',
  'Entertainment',
  'Food & Drinks',
  'Transportation',
  'Accessories',
  'Others'
];

// Maintenance Mode
let maintenanceMode = false;
const checkMaintenanceMode = (chatId) => {
  if (maintenanceMode) {
    bot.sendMessage(chatId,
      `*Maintenance in Progress*\n\n` +
      `We're improving the marketplace. Back in 30-60 mins.\n\n` +
      `Thank you for your patience!`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }
  return false;
};

// MAIN MENU
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
  bot.sendMessage(chatId,
    `*Jimma University Marketplace*\n\n` +
    `Welcome to JU Student Marketplace!\n\n` +
    `Choose an option:`,
    { parse_mode: 'Markdown', ...options }
  );
};

// START
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
    `*Welcome to JU Marketplace!*\n\n` +
    `Buy & Sell within JU Community\n` +
    `Books, Electronics, Clothes & more\n` +
    `Safe campus transactions\n` +
    `All products posted in @jumarket\n\n` +
    `Start browsing or selling!`,
    { parse_mode: 'Markdown' }
  );
  showMainMenu(chatId);
});

// BROWSE PRODUCTS
bot.onText(/\/browse|Browse Products/, async (msg) => {
  const chatId = msg.chat.id;
  if (checkMaintenanceMode(chatId)) return;

  const approvedProducts = Array.from(products.values())
    .filter(p => p.status === 'approved')
    .slice(0, 10);

  if (approvedProducts.length === 0) {
    await bot.sendMessage(chatId,
      `*Browse Products*\n\nNo products available yet.\n\nBe the first to list! Use "Sell Item".`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await bot.sendMessage(chatId, `*Available Products (${approvedProducts.length})*\n\nLatest items:`, { parse_mode: 'Markdown' });

  for (const product of approvedProducts) {
    const seller = users.get(product.sellerId);
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buy Now', callback_data: `buy_${product.id}` }, { text: 'Contact Seller', callback_data: `contact_${product.id}` }],
          [{ text: 'View Details', callback_data: `details_${product.id}` }]
        ]
      }
    };

    try {
      await bot.sendPhoto(chatId, product.images[0], {
        caption: `*${product.title}*\n\n` +
                 `Price: ${product.price} ETB\n` +
                 `Category: ${product.category}\n` +
                 `Seller: ${seller?.firstName || 'JU Student'}\n` +
                 `${product.description ? `Description: ${product.description}\n` : ''}` +
                 `\nCampus Meetup`,
        parse_mode: 'Markdown',
        ...keyboard
      });
    } catch {
      await bot.sendMessage(chatId,
        `*${product.title}*\nPrice: ${product.price} ETB\nCategory: ${product.category}\nSeller: ${seller?.firstName || 'JU Student'}`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    }
    await new Promise(r => setTimeout(r, 300));
  }
});

// SELL ITEM
bot.onText(/\/sell|Sell Item/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (checkMaintenanceMode(chatId)) return;

  userStates.set(userId, { state: 'awaiting_product_images', productData: {} });
  await bot.sendMessage(chatId,
    `*Sell Your Item - Step 1/5*\n\nSend 1-5 photos of your item.`,
    { parse_mode: 'Markdown' }
  );
});

// PHOTO HANDLER
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userState = userStates.get(userId);

  if (userState?.state === 'awaiting_product_images') {
    const photo = msg.photo[msg.photo.length - 1];
    if (!userState.productData.images) userState.productData.images = [];
    userState.productData.images.push(photo.file_id);
    userStates.set(userId, userState);

    if (userState.productData.images.length === 1) {
      await bot.sendMessage(chatId, `First photo received!\n\nSend more or type *next* to continue.`, { parse_mode: 'Markdown' });
    } else if (userState.productData.images.length >= 5) {
      userState.state = 'awaiting_product_title';
      userStates.set(userId, userState);
      await bot.sendMessage(chatId, `*Step 2/5 - Product Title*\n\nEnter a clear title:`, { parse_mode: 'Markdown' });
    }
  }
});

// TEXT HANDLER (PRODUCT CREATION + ADMIN)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const userState = userStates.get(userId);

  if (userState) {
    if (userState.state === 'awaiting_product_images' && text.toLowerCase() === 'next' && userState.productData.images?.length > 0) {
      userState.state = 'awaiting_product_title';
      userStates.set(userId, userState);
      await bot.sendMessage(chatId, `*Step 2/5 - Product Title*\n\nEnter title:`, { parse_mode: 'Markdown' });
      return;
    }

    if (userState.state === 'awaiting_product_title') {
      userState.productData.title = text;
      userState.state = 'awaiting_product_price';
      userStates.set(userId, userState);
      await bot.sendMessage(chatId, `*Step 3/5 - Price*\n\nEnter price in ETB:`, { parse_mode: 'Markdown' });
      return;
    }

    if (userState.state === 'awaiting_product_price') {
      if (!isNaN(text) && parseInt(text) > 0) {
        userState.productData.price = parseInt(text);
        userState.state = 'awaiting_product_description';
        userStates.set(userId, userState);
        await bot.sendMessage(chatId, `*Step 4/5 - Description (optional)*\n\nType /skip to skip:`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, 'Invalid price. Use numbers only.');
      }
      return;
    }

    if (userState.state === 'awaiting_product_description') {
      userState.productData.description = text === '/skip' ? '' : text;
      await selectProductCategory(chatId, userId, userState);
      return;
    }

    // ADMIN MESSAGING
    if (ADMIN_IDS.includes(userId)) {
      if (userState.state === 'awaiting_user_id_for_message') {
        const targetId = parseInt(text);
        if (isNaN(targetId) || !users.has(targetId)) {
          await bot.sendMessage(chatId, 'Invalid User ID.');
          return;
        }
        userStates.set(userId, { state: 'awaiting_individual_message', targetUserId: targetId });
        const target = users.get(targetId);
        await bot.sendMessage(chatId, `Message to *${target.firstName}*:\n\nSend your message:`, { parse_mode: 'Markdown' });
        return;
      }

      if (userState.state === 'awaiting_individual_message') {
        const targetId = userState.targetUserId;
        const target = users.get(targetId);
        await bot.sendMessage(targetId, `*Message from Admin*\n\n${text}\n\n*JU Marketplace*`, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, `Sent to *${target.firstName}* (@${target.username || 'No username'})`, { parse_mode: 'Markdown' });
        userStates.delete(userId);
        return;
      }

      if (userState.state === 'awaiting_broadcast_message') {
        const keyboard = {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Send to All', callback_data: `confirm_broadcast_${encodeURIComponent(text)}` },
              { text: 'Cancel', callback_data: 'cancel_broadcast' }
            ]]
          }
        };
        await bot.sendMessage(chatId, `*Confirm Broadcast*\n\n"${text}"\n\nSend to ${users.size} users?`, { parse_mode: 'Markdown', ...keyboard });
        userStates.delete(userId);
        return;
      }
    }

    // CONTACT MESSAGES
    if (userState.state.includes('awaiting_')) {
      await handleContactMessage(msg, userState.state);
      return;
    }
  }
});

// CATEGORY SELECTION
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
  await bot.sendMessage(chatId, `*Step 5/5 - Select Category*`, { parse_mode: 'Markdown', ...keyboard });
}

// MY PRODUCTS
bot.onText(/\/myproducts|My Products/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (checkMaintenanceMode(chatId)) return;

  const myProducts = Array.from(products.values()).filter(p => p.sellerId === userId);
  if (myProducts.length === 0) {
    await bot.sendMessage(chatId, `*My Products*\n\nYou haven't listed anything yet.\n\nUse "Sell Item" to start!`, { parse_mode: 'Markdown' });
    return;
  }

  let msgText = `*Your Products (${myProducts.length})*\n\n`;
  myProducts.forEach((p, i) => {
    const icon = p.status === 'approved' ? '' : p.status === 'pending' ? '' : p.status === 'sold' ? '' : '';
    msgText += `${i+1}. ${icon} *${p.title}*\n   ${p.price} ETB | ${p.category} | ${p.status}\n\n`;
  });
  await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
});

// SINGLE CALLBACK QUERY HANDLER
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = msg.chat.id;

  try {
    // USER CALLBACKS
    if (data.startsWith('category_')) {
      const category = data.replace('category_', '');
      const state = userStates.get(userId);
      if (state?.state === 'awaiting_product_category') {
        await completeProductCreation(chatId, userId, state, category, callbackQuery.id);
      }
      return;
    }

    if (data.startsWith('buy_')) {
      await handleBuyProduct(chatId, userId, parseInt(data.replace('buy_', '')), callbackQuery.id);
      return;
    }

    if (data.startsWith('contact_')) {
      await handleContactSeller(chatId, userId, parseInt(data.replace('contact_', '')), callbackQuery.id);
      return;
    }

    if (data.startsWith('details_')) {
      await handleViewDetails(chatId, parseInt(data.replace('details_', '')), callbackQuery.id);
      return;
    }

    if (data === 'cancel_product') {
      userStates.delete(userId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled' });
      await bot.sendMessage(chatId, 'Product creation cancelled.');
      return;
    }

    // CONTACT CALLBACKS
    if (['report_issue', 'give_suggestion', 'urgent_help', 'general_question', 'main_menu'].includes(data)) {
      await handleContactCallback(callbackQuery, data);
      return;
    }

    // ADMIN ONLY
    if (!ADMIN_IDS.includes(userId)) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Admin access required' });
      return;
    }

    if (data.startsWith('approve_')) {
      await handleAdminApproval(parseInt(data.replace('approve_', '')), callbackQuery, true);
      return;
    }

    if (data.startsWith('reject_')) {
      await handleAdminApproval(parseInt(data.replace('reject_', '')), callbackQuery, false);
      return;
    }

    if (data.startsWith('message_seller_') || data.startsWith('message_user_')) {
      const targetId = parseInt(data.split('_').pop());
      const target = users.get(targetId);
      if (!target) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'User not found' });
        return;
      }
      userStates.set(userId, { state: 'awaiting_individual_message', targetUserId: targetId });
      await bot.sendMessage(chatId, `Reply to *${target.firstName}*:\n\nSend message:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Type message' });
      return;
    }

    if (data.startsWith('admindetails_')) {
      await handleViewDetails(chatId, parseInt(data.replace('admindetails_', '')), callbackQuery.id);
      return;
    }

    if (data.startsWith('confirm_broadcast_')) {
      const text = decodeURIComponent(data.replace('confirm_broadcast_', ''));
      let sent = 0, failed = 0;
      for (const [uid, u] of users) {
        try {
          await bot.sendMessage(uid, `*Announcement*\n\n${text}\n\n*JU Marketplace*`, { parse_mode: 'Markdown' });
          sent++;
          await new Promise(r => setTimeout(r, 100));
        } catch { failed++; }
      }
      await bot.editMessageText(`*Broadcast Sent*\n\nSent: ${sent}\nFailed: ${failed}`, {
        chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown'
      });
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Sent to ${sent}` });
      return;
    }

    if (data === 'cancel_broadcast') {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled' });
      return;
    }

  } catch (err) {
    console.error('Callback error:', err);
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error' });
  }
});

// COMPLETE PRODUCT
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
  await bot.sendMessage(chatId, `*Product Submitted!*\n\nStatus: Pending Approval\n\nIt will appear in @jumarket soon.`, { parse_mode: 'Markdown' });
  showMainMenu(chatId);
}

// NOTIFY ADMINS
async function notifyAdminsAboutNewProduct(product) {
  const seller = users.get(product.sellerId);
  for (const adminId of ADMIN_IDS) {
    try {
      const kb = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Approve', callback_data: `approve_${product.id}` }, { text: 'Reject', callback_data: `reject_${product.id}` }],
            [{ text: 'Message Seller', callback_data: `message_seller_${product.sellerId}` }, { text: 'Details', callback_data: `admindetails_${product.id}` }]
          ]
        }
      };
      try {
        await bot.sendPhoto(adminId, product.images[0], {
          caption: `*NEW PRODUCT*\n\nTitle: ${product.title}\nPrice: ${product.price} ETB\nCategory: ${product.category}\nSeller: ${seller.firstName}\nSubmitted: ${product.createdAt.toLocaleString()}`,
          parse_mode: 'Markdown', ...kb
        });
      } catch {
        await bot.sendMessage(adminId, `*NEW PRODUCT*\n\nTitle: ${product.title}\nPrice: ${product.price} ETB\nSeller: ${seller.firstName}`, { parse_mode: 'Markdown', ...kb });
      }
    } catch (err) {
      console.error(`Failed to notify admin ${adminId}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

// ADMIN APPROVAL
async function handleAdminApproval(productId, callbackQuery, approve) {
  const adminId = callbackQuery.from.id;
  const msg = callbackQuery.message;
  const product = products.get(productId);
  if (!product) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Not found' });
    return;
  }

  if (approve) {
    product.status = 'approved';
    product.approvedBy = adminId;
    const seller = users.get(product.sellerId);
    const kb = {
      reply_markup: {
        inline_keyboard: [[{ text: 'BUY NOW', callback_data: `buy_${product.id}` }, { text: 'CONTACT SELLER', callback_data: `contact_${product.id}` }]]
      }
    };
    await bot.sendPhoto(CHANNEL_ID, product.images[0], {
      caption: `*${product.title}*\n\nPrice: ${product.price} ETB\nCategory: ${product.category}\nSeller: ${seller.firstName}\n\nCampus Meetup\n\n@JUMarketplaceBot`,
      parse_mode: 'Markdown', ...kb
    });
    await bot.sendMessage(product.sellerId, `*Approved!*\n\nYour product is live in @jumarket!`, { parse_mode: 'Markdown' });
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Approved & Posted!' });
  } else {
    product.status = 'rejected';
    await bot.sendMessage(product.sellerId, `*Not Approved*\n\nYour product was rejected. Try again with better details.`, { parse_mode: 'Markdown' });
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Rejected' });
  }
}

// CONTACT HANDLERS
async function handleContactCallback(callbackQuery, type) {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;

  if (type === 'main_menu') {
    userStates.delete(userId);
    await showMainMenu(chatId);
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Main menu' });
    return;
  }

  const states = { report_issue: 'awaiting_issue_report', give_suggestion: 'awaiting_suggestion', urgent_help: 'awaiting_urgent_help', general_question: 'awaiting_general_question' };
  userStates.set(userId, { state: states[type] });
  const prompts = { report_issue: 'Describe the issue:', give_suggestion: 'Your suggestion:', urgent_help: 'Urgent issue:', general_question: 'Your question:' };
  await bot.sendMessage(chatId, `Please type:\n\n${prompts[type]}`, { parse_mode: 'Markdown' });
  await bot.answerCallbackQuery(callbackQuery.id, { text: 'Type below' });
}

async function handleContactMessage(msg, state) {
  const userId = msg.from.id;
  const text = msg.text;
  const user = users.get(userId);
  const type = state.split('_')[1];

  const adminMsg = `*${type.toUpperCase()}*\n\nFrom: ${user.firstName} (@${user.username || 'No username'})\nID: ${userId}\n\n${text}\n\n_Time: ${new Date().toLocaleString()}_`;
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.sendMessage(adminId, adminMsg, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `message_user_${userId}` }]] }
      });
    } catch {}
  }
  await bot.sendMessage(msg.chat.id, `Submitted! We'll respond soon.\n\nReference: ${type}-${Date.now()}`, { parse_mode: 'Markdown' });
  userStates.delete(userId);
  showMainMenu(msg.chat.id);
}

// ADMIN COMMANDS
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  const pending = Array.from(products.values()).filter(p => p.status === 'pending').length;
  const kb = {
    reply_markup: {
      keyboard: [[{ text: `Pending (${pending})` }, { text: 'Stats' }], [{ text: 'Message User' }, { text: 'Broadcast' }], [{ text: 'Users' }, { text: 'All Products' }], [{ text: 'Main Menu' }]],
      resize_keyboard: true
    }
  };
  await bot.sendMessage(chatId, `*Admin Panel*\n\nUsers: ${users.size}\nProducts: ${products.size}\nPending: ${pending}`, { parse_mode: 'Markdown', ...kb });
});

bot.onText(/\/pending/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  const pending = Array.from(products.values()).filter(p => p.status === 'pending');
  if (pending.length === 0) {
    await bot.sendMessage(chatId, 'No pending products.', { parse_mode: 'Markdown' });
    return;
  }
  for (const p of pending) {
    const seller = users.get(p.sellerId);
    const kb = { reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: `approve_${p.id}` }, { text: 'Reject', callback_data: `reject_${p.id}` }]] } };
    try {
      await bot.sendPhoto(chatId, p.images[0], { caption: `*${p.title}*\nPrice: ${p.price} ETB\nSeller: ${seller.firstName}`, parse_mode: 'Markdown', ...kb });
    } catch {
      await bot.sendMessage(chatId, `*${p.title}*\nSeller: ${seller.firstName}`, { parse_mode: 'Markdown', ...kb });
    }
    await new Promise(r => setTimeout(r, 300));
  }
});

bot.onText(/\/stats|Stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  const stats = {
    users: users.size,
    products: products.size,
    approved: Array.from(products.values()).filter(p => p.status === 'approved').length,
    pending: Array.from(products.values()).filter(p => p.status === 'pending').length
  };
  await bot.sendMessage(chatId, `*Stats*\n\nUsers: ${stats.users}\nProducts: ${stats.products}\nApproved: ${stats.approved}\nPending: ${stats.pending}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/messageuser/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  userStates.set(userId, { state: 'awaiting_user_id_for_message' });
  await bot.sendMessage(chatId, `Send User ID to message:`, { parse_mode: 'Markdown' });
});

bot.onText(/\/broadcast/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  userStates.set(userId, { state: 'awaiting_broadcast_message' });
  await bot.sendMessage(chatId, `Send broadcast message:`, { parse_mode: 'Markdown' });
});

bot.onText(/\/maintenance (on|off)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) return;

  maintenanceMode = match[1] === 'on';
  await bot.sendMessage(chatId, `Maintenance mode: ${maintenanceMode ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
});

// HELP & CONTACT
bot.onText(/\/help|Help/, async (msg) => {
  const chatId = msg.chat.id;
  if (checkMaintenanceMode(chatId)) return;

  const isAdmin = ADMIN_IDS.includes(msg.from.id);
  let help = `*Help*\n\n*Buy:* Browse → Buy Now\n*Sell:* Sell Item → Follow steps\n*Safety:* Meet in public, cash only\n\nCategories: ${CATEGORIES.slice(0, 5).join(', ')}...\n\nCommands:\n/start /browse /sell /myproducts /contact /status /about`;
  if (isAdmin) help += `\n\n*Admin:* /admin /pending /stats /broadcast`;
  await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
});

bot.onText(/\/contact|Contact Admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (checkMaintenanceMode(chatId)) return;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Report Issue', callback_data: 'report_issue' }, { text: 'Suggestion', callback_data: 'give_suggestion' }],
        [{ text: 'Urgent Help', callback_data: 'urgent_help' }, { text: 'Question', callback_data: 'general_question' }],
        [{ text: 'Main Menu', callback_data: 'main_menu' }]
      ]
    }
  };
  await bot.sendMessage(chatId, `*Contact Admin*\n\nHow can we help?`, { parse_mode: 'Markdown', ...kb });
});

// STATUS & ABOUT
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const stats = {
    users: users.size,
    products: products.size,
    approved: Array.from(products.values()).filter(p => p.status === 'approved').length
  };
  await bot.sendMessage(chatId, `*Status*\n\nUsers: ${stats.users}\nProducts: ${stats.products}\nApproved: ${stats.approved}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/about/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `*About JU Marketplace*\n\nStudent-only trading platform for Jimma University.\nSafe, fast, campus-focused.\n\nLaunched: 2025\nVersion: 2.0`, { parse_mode: 'Markdown' });
});

// CANCEL
bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userStates.has(userId)) {
    userStates.delete(userId);
    await bot.sendMessage(chatId, 'Action cancelled.', { parse_mode: 'Markdown' });
  }
  showMainMenu(chatId);
});

console.log('JU Marketplace Bot fully operational!');
