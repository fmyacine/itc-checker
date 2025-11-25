const { Client, GatewayIntentBits } = require("discord.js");
const { google } = require("googleapis");
const fs = require("fs");
require("dotenv").config();


const credJSON = JSON.parse(Buffer.from(process.env.CRED, "base64").toString("utf-8"));

const auth = new google.auth.GoogleAuth({
  credentials: credJSON,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
}); 

const sheets = google.sheets({ version: "v4", auth });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.on("guildMemberAdd", async (member) => {
  try {
    console.log(`User joined: ${member.user.tag}`);

    // Username
    const username = member.user.tag;

    // Read Google Sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:A"
    });

    const allowedList = response.data.values.flat();
    const isAllowed = allowedList.includes(username);

    // If allowed → do nothing
    if (isAllowed) {
      console.log(`${username} is allowed.`);
      return;
    }

    // -------------------------------------------------------
    // Send DM BEFORE kicking
    // -------------------------------------------------------
    try {
      await member.send(
        "🚫 **Access Denied**\n\n" +
        "You're **not authorized** to join this server.\n" +
        "If you believe this is a mistake, please contact **any board member**."
      );
    } catch (dmError) {
      console.log("Could not DM the user (DMs likely closed).");
    }

    // Kick user
    await member.kick("Not found in Google Sheet");
    console.log(`${username} was kicked.`);

  } catch (err) {
    console.error("Error:", err);
  }
});


client.login(process.env.BOT_TOKEN);
