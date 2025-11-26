const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  PermissionFlagsBits 
} = require("discord.js");
const { google } = require("googleapis");
const fs = require("fs");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
require("dotenv").config();

// ======================================================
// GOOGLE AUTH FROM BASE64 ENV
// ======================================================
const credJSON = JSON.parse(
  Buffer.from(process.env.CRED, "base64").toString("utf-8")
);

const auth = new google.auth.GoogleAuth({
  credentials: credJSON,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
});

const sheets = google.sheets({ version: "v4", auth });

// ======================================================
// DISCORD CLIENT
// ======================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ======================================================
// CSV SETUP
// ======================================================
const CSV_FILE = "users_cache.csv";

const csvWriter = createObjectCsvWriter({
  path: CSV_FILE,
  header: [
    { id: "discord_id", title: "discord_id" },
    { id: "advanced", title: "advanced" },
    { id: "beginner", title: "beginner" }
  ]
});

// ======================================================
// REGISTER /UPDATE COMMAND
// ======================================================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const updateCommand = new SlashCommandBuilder()
    .setName("update")
    .setDescription("Fetch Google Sheet and update local CSV + roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  await client.application.commands.set([updateCommand]);
  console.log("✅ /update command registered");
});

// ======================================================
// /UPDATE → FETCH FROM SHEETS → SAVE TO CSV → SYNC ROLES
// ======================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "update") return;

  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ You are not authorized to use this command.",
      ephemeral: true
    });
  }

  await interaction.reply("⏳ Fetching data from Google Sheets...");

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "Database!H:M"
    });

    const rows = response.data.values || [];

    const formattedData = rows.map(r => ({
      discord_id: r[0],
      advanced: String(r[4]).toLowerCase(),
      beginner: String(r[5]).toLowerCase()
    }));

    // Save to CSV
    await csvWriter.writeRecords(formattedData);

    await interaction.editReply(
      `✅ CSV Updated Successfully\nRecords: **${formattedData.length}**`
    );

    console.log("✅ CSV cache updated");

  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ Error while fetching Google Sheets.");
  }
});

// ======================================================
// ON MEMBER JOIN → READ FROM LOCAL CSV → ASSIGN ROLE
// ======================================================
client.on("guildMemberAdd", async (member) => {
  if (!fs.existsSync(CSV_FILE)) {
    console.log("⚠ CSV not found. Run /update first.");
    return;
  }

  const guild = member.guild;

  // Give "Participants" role immediately
  const participantsRole = guild.roles.cache.find(r => r.name === "Participants");
  if (participantsRole && !member.roles.cache.has(participantsRole.id)) {
    await member.roles.add(participantsRole);
    console.log(`✅ ${member.user.tag} → Participants role added`);
  }

  const users = [];

  fs.createReadStream(CSV_FILE)
    .pipe(csv())
    .on("data", (row) => users.push(row))
    .on("end", async () => {

      // Check by discord_id OR username
      const user = users.find(u =>
        String(u.discord_id || "").trim() === member.id ||
        String(u.discord_id || "").toLowerCase().trim() === member.user.username.toLowerCase()
      );

      // ❌ Not found → kick
      if (!user) {
        try {
          await member.send(
            "🚫 **Access Denied**\n\n" +
            "You're **not authorized** to join this server.\n" +
            "If you believe this is a mistake, please contact **any board member**."
          );
        } catch {
          console.log("⚠ Could not DM user before kick.");
        }

        try {
          await member.kick("User not found in whitelist CSV");
          console.log(`❌ ${member.user.tag} kicked (not in whitelist).`);
        } catch (err) {
          console.log("❌ Kick failed:", err.message);
        }

        return;
      }

      // ✅ User found → assign role from CSV row
      const advancedRole = guild.roles.cache.find(r => r.name === "[ Advanced ]");
      const beginnerRole = guild.roles.cache.find(r => r.name === "[ Beginners ]");
      const idleRole = guild.roles.cache.find(r => r.name === "Idle");

      if (!advancedRole || !beginnerRole || !idleRole) {
        console.log("❌ One or more roles are missing in the server.");
        return;
      }

      const isAdvanced = String(user.advanced).toLowerCase() === "true";
      const isBeginner = String(user.beginner).toLowerCase() === "true";

      // Add roles without removing existing ones
      if (isAdvanced && !member.roles.cache.has(advancedRole.id)) {
        await member.roles.add(advancedRole);
        console.log(`✅ ${member.user.tag} → Advanced`);
      } else if (isBeginner && !member.roles.cache.has(beginnerRole.id)) {
        await member.roles.add(beginnerRole);
        console.log(`✅ ${member.user.tag} → Beginner`);
      } else if (!isAdvanced && !isBeginner && !member.roles.cache.has(idleRole.id)) {
        await member.roles.add(idleRole);
        console.log(`✅ ${member.user.tag} → Idle`);
      }
    });
});


// ======================================================
client.login(process.env.BOT_TOKEN);
