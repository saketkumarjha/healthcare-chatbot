import express from "express";
import twilio from "twilio";
import axios from "axios";

const router = express.Router();

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;

const client = twilio(accountSid, authToken);

// Your chatbot API URL
const CHATBOT_API_URL =
  process.env.CHATBOT_API_URL || "http://localhost:3000/api";

// Store conversation history (use Redis/DB in production)
const conversationHistory = new Map();

// Helper function to send WhatsApp message
async function sendWhatsAppMessage(to, body) {
  try {
    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      body: body,
      to: to,
    });
    console.log("✅ Message sent:", message.sid);
    return message;
  } catch (error) {
    console.error("❌ Error sending message:", error);
    throw error;
  }
}

// Webhook endpoint for incoming messages
router.post("/webhook", async (req, res) => {
  try {
    const incomingMessage = req.body.Body;
    const senderNumber = req.body.From;
    const senderName = req.body.ProfileName || "User";

    console.log(
      `📱 Message from ${senderName} (${senderNumber}): ${incomingMessage}`
    );

    // Get or initialize conversation history
    if (!conversationHistory.has(senderNumber)) {
      conversationHistory.set(senderNumber, []);
    }
    const history = conversationHistory.get(senderNumber);

    // Send message to your RAG chatbot
    let botReply;
    try {
      const chatbotResponse = await axios.post(
        `${CHATBOT_API_URL}/chat`,
        {
          message: incomingMessage,
          conversationHistory: history,
        },
        {
          timeout: 25000,
        }
      );

      botReply =
        chatbotResponse.data.response ||
        chatbotResponse.data.message ||
        chatbotResponse.data.answer ||
        "I received your message!";
    } catch (apiError) {
      console.error("Chatbot API error:", apiError.message);
      botReply =
        "Sorry, I'm having trouble processing your request right now. Please try again.";
    }

    // Update conversation history
    history.push(
      { role: "user", content: incomingMessage },
      { role: "assistant", content: botReply }
    );

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Send response back to WhatsApp
    await sendWhatsAppMessage(senderNumber, botReply);

    // Respond to Twilio
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response></Response>");
  } catch (error) {
    console.error("❌ Webhook error:", error);

    try {
      await sendWhatsAppMessage(
        req.body.From,
        "Sorry, something went wrong. Please try again."
      );
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response></Response>");
  }
});

// Health check
router.post("/webhook", async (req, res) => {
  try {
    const incomingMessage = req.body.Body;
    const senderNumber = req.body.From; // Already in format: whatsapp:+919263698519
    const senderName = req.body.ProfileName || "User";

    console.log(
      `📱 Message from ${senderName} (${senderNumber}): ${incomingMessage}`
    );

    // Validate sender number format
    if (!senderNumber || !senderNumber.startsWith("whatsapp:")) {
      console.error("❌ Invalid sender number format:", senderNumber);
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end("<Response></Response>");
    }

    // Get or initialize conversation history
    if (!conversationHistory.has(senderNumber)) {
      conversationHistory.set(senderNumber, []);
    }
    const history = conversationHistory.get(senderNumber);

    // Send message to your RAG chatbot
    let botReply;
    try {
      console.log("🤖 Calling chatbot API:", CHATBOT_API_URL);

      const chatbotResponse = await axios.post(
        `${CHATBOT_API_URL}`,
        {
          message: incomingMessage,
          conversationHistory: history,
        },
        {
          timeout: 25000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      botReply =
        chatbotResponse.data.response ||
        chatbotResponse.data.message ||
        chatbotResponse.data.answer ||
        "I received your message!";

      console.log("✅ Chatbot response received:", botReply.substring(0, 100));
    } catch (apiError) {
      console.error("❌ Chatbot API error:", apiError.message);
      console.error("API URL:", CHATBOT_API_URL);
      console.error("Status:", apiError.response?.status);
      console.error("Data:", apiError.response?.data);

      botReply =
        "Sorry, I'm having trouble processing your request right now. Please try again.";
    }

    // Update conversation history
    history.push(
      { role: "user", content: incomingMessage },
      { role: "assistant", content: botReply }
    );

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Send response back to WhatsApp (number is already in correct format)
    console.log("📤 Sending reply to:", senderNumber);
    await sendWhatsAppMessage(senderNumber, botReply);

    // Respond to Twilio
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response></Response>");
  } catch (error) {
    console.error("❌ Webhook error:", error);

    try {
      const senderNumber = req.body.From;
      if (senderNumber && senderNumber.startsWith("whatsapp:")) {
        await sendWhatsAppMessage(
          senderNumber,
          "Sorry, something went wrong. Please try again."
        );
      }
    } catch (sendError) {
      console.error("Failed to send error message:", sendError.message);
    }

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response></Response>");
  }
});

// Test endpoint - send a message
router.post("/send", async (req, res) => {
  try {
    const { to, message } = req.body;

    // Debug: Log what we're receiving
    console.log("📨 Send request received:");
    console.log("  To:", to);
    console.log("  Message:", message);

    if (!to || !message) {
      return res.status(400).json({
        error: "Missing required fields: to, message",
      });
    }

    // Debug: Log credentials being used
    console.log("🔑 Using credentials:");
    console.log(
      "  Account SID:",
      accountSid ? `${accountSid.substring(0, 10)}...` : "NOT SET"
    );
    console.log(
      "  Auth Token:",
      authToken ? `${authToken.substring(0, 10)}...` : "NOT SET"
    );
    console.log("  WhatsApp Number:", twilioWhatsAppNumber);

    // Better phone number formatting
    let formattedTo = to;
    if (!formattedTo.startsWith("whatsapp:")) {
      // Remove any spaces and ensure + is included
      const cleanNumber = to.replace(/\s+/g, "");
      formattedTo = cleanNumber.startsWith("+")
        ? `whatsapp:${cleanNumber}`
        : `whatsapp:+${cleanNumber}`;
    }

    console.log("📤 Attempting to send message via Twilio...");
    const result = await sendWhatsAppMessage(formattedTo, message);

    console.log("✅ Message sent successfully:", result.sid);

    res.json({
      success: true,
      messageSid: result.sid,
      to: formattedTo,
    });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      moreInfo: error.moreInfo,
    });

    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

router.get("/debug/credentials", (req, res) => {
  res.json({
    accountSid: {
      exists: !!accountSid,
      value: accountSid
        ? `${accountSid.substring(0, 10)}...${accountSid.substring(
            accountSid.length - 4
          )}`
        : null,
      length: accountSid ? accountSid.length : 0,
      startsWithAC: accountSid ? accountSid.startsWith("AC") : false,
    },
    authToken: {
      exists: !!authToken,
      length: authToken ? authToken.length : 0,
      firstChars: authToken ? authToken.substring(0, 4) : null,
    },
    whatsappNumber: {
      exists: !!twilioWhatsAppNumber,
      value: twilioWhatsAppNumber,
      hasPrefix: twilioWhatsAppNumber
        ? twilioWhatsAppNumber.startsWith("whatsapp:")
        : false,
    },
    rawEnvVars: {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? "SET" : "NOT SET",
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "SET" : "NOT SET",
      TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER || "NOT SET",
    },
  });
});
// Send template message (like your Twilio example)
router.post("/send-template", async (req, res) => {
  try {
    const { to, contentSid, variables } = req.body;

    if (!to || !contentSid) {
      return res.status(400).json({
        error: "Missing required fields: to, contentSid",
      });
    }

    const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      contentSid: contentSid,
      contentVariables: JSON.stringify(variables || {}),
      to: formattedTo,
    });

    res.json({
      success: true,
      messageSid: message.sid,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test connection - send a test message
router.post("/test", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({
        error: "Missing required field: to (phone number)",
      });
    }

    const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

    const message = await client.messages.create({
      from: twilioWhatsAppNumber,
      body: "🤖 Hello! Your RAG Chatbot is now connected to WhatsApp. Send me a message to get started!",
      to: formattedTo,
    });

    res.json({
      success: true,
      messageSid: message.sid,
      message: "Test message sent successfully!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear conversation history for a user
router.delete("/history/:phoneNumber", (req, res) => {
  try {
    const phoneNumber = req.params.phoneNumber;
    const key = phoneNumber.startsWith("whatsapp:")
      ? phoneNumber
      : `whatsapp:${phoneNumber}`;
    conversationHistory.delete(key);

    res.json({
      success: true,
      message: "Conversation history cleared",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
