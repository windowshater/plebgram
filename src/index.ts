import dotenv from "dotenv";
import { startPlebbitFeedBot } from "./plebbitfeed/plebbit-feed-bot.js";
import TelegramBot from "node-telegram-bot-api";
import { client } from "./config/db.js";

dotenv.config();

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not set");
}

const plebbitFeedTgBot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: false,
});

const start = async () => {
    try {
        await client.connect();
        startPlebbitFeedBot(plebbitFeedTgBot);
    } catch (error) {
        console.log(error);
    }
};
start();
