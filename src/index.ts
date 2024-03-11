import dotenv from "dotenv";
import { startPlebbitFeedBot } from "./plebbitfeed/plebbit-feed-bot.js";
import { client } from "./config/db.js";
import { Scenes, Telegraf } from "telegraf";
import { startPlebgramBot } from "./plebgram/plebgram-bot.js";

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
        console.log("Connected to redis");
        startPlebbitFeedBot(plebbitFeedTgBot);
        startPlebgramBot(plebbitFeedTgBot);
    } catch (error) {
        console.log(error);
    }
};
start();
