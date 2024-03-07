import dotenv from "dotenv";
import { startPlebbitFeedBot } from "./plebbitfeed/plebbit-feed-bot.js";
import TelegramBot from "node-telegram-bot-api";
import { client } from "./config/db.js";
import { UserService } from "./services/user.service.js";

dotenv.config();

if (!process.env.FEED_BOT_TOKEN) {
    throw new Error("FEED_BOT_TOKEN is not set");
}

const plebbitFeedTgBot = new TelegramBot(process.env.FEED_BOT_TOKEN, {
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
