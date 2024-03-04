import dotenv from "dotenv";
import { main } from "./plebbitfeed/plebbit-feed-bot.js";
import TelegramBot from "node-telegram-bot-api";

dotenv.config();
const tgBot = new TelegramBot(process.env.FEED_BOT_TOKEN, {
    polling: false,
});
main(tgBot);
