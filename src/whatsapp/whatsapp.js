import twilio from 'twilio';
import axios from 'axios';

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER; // format: whatsapp:+14155238886

const client = twilio(accountSid, authToken);

// Your deployed chatbot API URL
const CHATBOT_API_URL = process.env.CHATBOT_API_URL || 'https://your-vercel-app.vercel.app/api';

// Store conversation history (use Redis/DB in production)
const conversationHistory = new Map();

/**
 * Send a WhatsApp message
 */
export async function sendWhatsAppMessage(to, body) {
  try {
    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      body: body,
      to: to // format: whatsapp:+919263698519
    });
    console.log('Message sent:', message.sid);
    return message;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
}

/**
 * Send a template message with variables
 */
export async function sendTemplateMessage(to, contentSid, variables) {
  try {
    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      contentSid: contentSid, // e.g., 'HXb5b62575e6e4ff6129ad7c8efe1f983e'
      contentVariables: JSON.stringify(variables), // e.g., {"1":"12/1","2":"3pm"}
      to: to
    });
    console.log('Template message sent:', message.sid);
    return message;
  } catch (error) {
    console.error('Error sending template message:', error);
    throw error;
  }
}

/**
 * Handle incoming WhatsApp webhook
 */
export async function handleIncomingMessage(req, res) {
  try {
    const incomingMessage = req.body.Body;
    const senderNumber = req.body.From; // format: whatsapp:+919263698519
    const senderName = req.body.ProfileName || 'User';

    console.log(`📱 Message from ${senderName} (${senderNumber}): ${incomingMessage}`);

    // Get or initialize conversation history
    if (!conversationHistory.has(senderNumber)) {
      conversationHistory.set(senderNumber, []);
    }
    const history = conversationHistory.get(senderNumber);

    // Send message to your RAG chatbot
    const chatbotResponse = await axios.post(`${CHATBOT_API_URL}/chat`, {
      message: incomingMessage,
      conversationHistory: history
    }, {
      timeout: 25000 // 25 second timeout
    });

    const botReply = chatbotResponse.data.response || 
                     chatbotResponse.data.message || 
                     chatbotResponse.data.answer ||
                     'I received your message but couldn\'t generate a response.';

    // Update conversation history
    history.push(
      { role: 'user', content: incomingMessage },
      { role: 'assistant', content: botReply }
    );

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Send response back to WhatsApp
    await sendWhatsAppMessage(senderNumber, botReply);

    // Respond to Twilio with empty TwiML
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<Response></Response>');

  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error.message);
    
    // Send error message to user
    try {
      await sendWhatsAppMessage(
        req.body.From,
        'Sorry, I encountered an error processing your message. Please try again in a moment.'
      );
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<Response></Response>');
  }
}

/**
 * Test sending a message
 */
export async function testMessage(to) {
  try {
    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      body: '🤖 Hello! Your RAG Chatbot is now connected to WhatsApp. Send me a message to get started!',
      to: to
    });
    return { success: true, sid: message.sid };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Clear conversation history for a user
 */
export function clearHistory(phoneNumber) {
  const key = phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;
  conversationHistory.delete(key);
  return { success: true, message: 'History cleared' };
}