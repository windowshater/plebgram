import dotenv from "dotenv";
import { startPlebbitFeedBot } from "./plebbitfeed/plebbit-feed-bot.js";
import { client } from "./config/db.js";
import { Scenes, Telegraf } from "telegraf";
import { startPlebgramBot } from "./plebgram/plebgram-bot.js";
import { Logger } from "tslog";

export const log = new Logger();
dotenv.config();

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not set");
}

const plebbitFeedTgBot = new Telegraf<Scenes.WizardContext>(
    process.env.BOT_TOKEN!
);

plebbitFeedTgBot.launch();

const start = async () => {
    try {
        await client.connect();
        log.info("Connected to database");
        startPlebbitFeedBot(plebbitFeedTgBot);
        startPlebgramBot(plebbitFeedTgBot);
    } catch (error) {
        log.error(error);
    }
};
start();
