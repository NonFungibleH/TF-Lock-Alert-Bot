// lib/alert-router.js
// Handles Telegram delivery based on score tier.
//   - All locks: edits the initial "Fetching..." message in #all-locks
//   - Opportunities (61+): also sends a new message to #opportunities

const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TOPIC_ALL_LOCKS = process.env.TELEGRAM_TOPIC_ALL_LOCKS;
const TOPIC_OPPORTUNITIES = process.env.TELEGRAM_TOPIC_OPPORTUNITIES;

async function telegramRequest(method, params) {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/${method}`,
      { ...params, parse_mode: 'Markdown', disable_web_page_preview: true },
      { timeout: 10000 }
    );
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.description || err.message;
    console.error(`❌ Telegram ${method} failed (${status}): ${errMsg}`);
    return null;
  }
}

async function routeAlert(ctx, message) {
  if (!TOKEN || !CHAT_ID) {
    console.error('❌ Missing Telegram credentials — cannot route alert');
    return;
  }

  // Step 1: Edit the existing #all-locks "Fetching..." message
  if (ctx.messageId) {
    await telegramRequest('editMessageText', {
      chat_id: CHAT_ID,
      message_id: ctx.messageId,
      text: message
    });
  }

  // Step 2: If opportunity tier, also post to #opportunities channel
  if (ctx.tier === 'opportunity' && TOPIC_OPPORTUNITIES) {
    await telegramRequest('sendMessage', {
      chat_id: CHAT_ID,
      message_thread_id: parseInt(TOPIC_OPPORTUNITIES),
      text: message
    });
    console.log(`🟢 Opportunity alert posted to #opportunities (score: ${ctx.totalScore})`);
  }
}

module.exports = { routeAlert };
