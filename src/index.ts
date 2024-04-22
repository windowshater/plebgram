import dotenv from "dotenv";
import { startPlebbitFeedBot } from "./plebbitfeed/plebbit-feed-bot.js";
import { client } from "./config/db.js";
import { Scenes, Telegraf } from "telegraf";
import { startPlebgramBot } from "./plebgram/plebgram-bot.js";
import { Logger } from "tslog";
import Plebbit from "@plebbit/plebbit-js";

export const log = new Logger();
dotenv.config();

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not set");
}
export const plebbitFeedTgBot = new Telegraf<Scenes.WizardContext>(
    process.env.BOT_TOKEN!
);

export const plebbit = await Plebbit({
    ipfsGatewayUrls: ["https://rannithepleb.com/api/v0"],
    ipfsHttpClientsOptions: ["http://localhost:5001/api/v0"],
});
plebbit.on("error", (error) => {
    log.error(error.details);
});

const start = async () => {
    try {
        plebbitFeedTgBot.launch();
        await client.connect();
        log.info("Connected to database");
        await Promise.all([
            startPlebbitFeedBot(plebbitFeedTgBot),
            startPlebgramBot(plebbitFeedTgBot),
        ]);
    } catch (error) {
        log.error(error);
    }
};
start();
