import dotenv from "dotenv";
import { main } from "./plebbitfeed/plebbit-feed-bot.js";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

if (!process.env.FEED_BOT_TOKEN) {
    throw new Error("FEED_BOT_TOKEN is not set");
}

const tgBot = new TelegramBot(process.env.FEED_BOT_TOKEN, {
    polling: false,
});

main(tgBot);
