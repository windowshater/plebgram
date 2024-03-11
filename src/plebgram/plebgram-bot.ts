import { Composer, Scenes, Telegraf, session } from "telegraf";
import { UserService } from "../services/user.service.js";
import { Redis } from "@telegraf/session/redis";
import { PlebbitService } from "../services/plebbit.service.js";
import { User } from "../models/user.js";
import { Signer } from "@plebbit/plebbit-js/dist/node/signer/index.js";
import { log } from "../index.js";
const userService = new UserService();
const plebbitService = new PlebbitService();
const scene = new Scenes.WizardScene<Scenes.WizardContext>(
    "sceneLogin",
    async (ctx) => {
        ctx.reply("Reply with your signer private key", {
            reply_markup: {
                force_reply: true,
            },
        });
        return ctx.wizard.next();
    },
    async (ctx) => {
        log.info(
            "private key is",
            "text" in ctx.message! ? ctx.message!.text : ""
        );
        const privateKey = "text" in ctx.message! ? ctx.message!.text : "";
        const loadedSigner = await registerUser(`${ctx.from!.id}`, privateKey);

        log.info(loadedSigner);
        if (!loadedSigner) {
            ctx.reply("Error: Invalid private key. Try again", {
                reply_markup: {
                    force_reply: true,
                },
            });
            return;
        }
        await ctx.reply(`Signer loaded successfully, login complete
Address: ${loadedSigner.address}
Private key: ${loadedSigner.privateKey}
Public Key: ${loadedSigner.publicKey}
Short Address: ${loadedSigner.shortAddress}`);
        return ctx.scene.leave();
    }
);
const stage = new Scenes.Stage<Scenes.WizardContext>([scene]);

async function registerUser(
    userId: string,
    privateKey: string
): Promise<Signer | null> {
    try {
        const loadedSigner = await plebbitService.loadSigner(privateKey);
        const user = new User();
        user.id = userId;
        user.privateKey = privateKey;
        await userService.createUser(user);
        return loadedSigner;
    } catch (e) {
        log.error(e);
        return null;
    }
}
export async function isUserRegistered(tgUserId: string) {
    const user = await userService.getUser(tgUserId);
    log.info("User already registred as", user);
    if (user) {
        return true;
    }
    return false;
}

export async function startPlebgramBot(bot: Telegraf<Scenes.WizardContext>) {
    bot.start(async (ctx) => {
        if (!(await isUserRegistered(`${ctx.from!.id}`))) {
            await ctx.reply(
                `Welcome to Plebgram. Please register first. 
Use /register to create a new user or /login to use an existing user.
This process cannot be undone for now.`
            );
        }
    });

    const store = Redis({ url: "redis://127.0.0.1:6379" }) as any;
    bot.use(session({ store }));
    log.info("storing sessions in redis");
    bot.use(stage.middleware());
    log.info("using middleware");
    bot.command("login", async (ctx) => {
        log.info("Someone asked for login");
        if (await isUserRegistered(`${ctx.message.chat.id}`)) {
            ctx.reply("You are already logged in");
            return;
        }
        log.info("User not logged in");
        ctx.scene.enter("sceneLogin");
    });
}
