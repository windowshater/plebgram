import { Markup, Scenes, Telegraf, session } from "telegraf";
import { UserService } from "../services/user.service.js";
import { Redis } from "@telegraf/session/redis";
import { PlebbitService } from "../services/plebbit.service.js";
import { User } from "../models/user.js";
import { Signer } from "@plebbit/plebbit-js/dist/node/signer/index.js";
import { log, plebbitFeedTgBot } from "../index.js";
import Plebbit from "@plebbit/plebbit-js";
import Vote from "@plebbit/plebbit-js/dist/node/vote.js";
import { message } from "telegraf/filters";
import { inspect } from "util";
import Jimp from "jimp";
const plebbit = await Plebbit({
    ipfsGatewayUrls: ["https://rannithepleb.com/api/v0"],
    ipfsHttpClientsOptions: [
        "http://localhost:5001/api/v0",
        "https://pubsubprovider.xyz/api/v0",
    ],
});
plebbit.on("error", (err) => {
    log.error(err);
});

const userService = new UserService();
const plebbitService = new PlebbitService();

const pendingVotes: { [key: string]: { vote: Vote; image: string }[] } = {};

const onVote = async (ctx: any, vote: 1 | -1) => {
    log.info(inspect(pendingVotes, false, 1));
    const signer = await getSignerFromTelgramUserId(`${ctx.from!.id}`);
    const [sub, post] = getSubPost(ctx.update.callback_query.message);
    if (!signer) {
        ctx.answerCbQuery("⚠️⚠️⚠️ start @plebgrambot ⚠️⚠️⚠️");
        return;
    }
    const newVote = await plebbit.createVote({
        signer: signer,
        vote: vote,
        subplebbitAddress: sub,
        commentCid: post,
    });
    newVote.on("challenge", (challengeMessage) => {
        log.info("Challenge received");
        sendChallengeMessage(
            `${ctx.from!.id}`,
            challengeMessage.challenges[0].challenge,
            newVote,
            false
        );
    });
    newVote.on("challengeverification", (challengeVerification) => {
        log.info("Verifying challenge answer");
        sendChallengeVerificationMessage(
            `${ctx.from!.id}`,
            challengeVerification,
            newVote
        );
    });
    newVote.on("error", (err) => {
        // this should destroy the vote if no challenge is received
        sendErrorMessage(`${ctx.from!.id}`, err);
        newVote.stop().catch((e) => log.error(e));
        newVote.removeAllListeners("challenge");
        newVote.removeAllListeners("challengeverification");
        newVote.removeAllListeners("error");
    });
    await newVote.publish();
};

const getSignerFromTelgramUserId = async (
    userId: string
): Promise<Signer | null> => {
    const user = await userService.getUser(userId);
    if (!user) {
        return null;
    }
    return await plebbitService.loadSigner(user.privateKey!);
};
const sendErrorMessage = async (userId: string, err: any) => {
    log.error(err);
    plebbitFeedTgBot.telegram.sendMessage(userId, "Error: " + err.message);
};
const sendChallengeMessage = async (
    userId: string,
    challenge: string,
    vote: Vote,
    alreadyCounted: boolean
) => {
    if (alreadyCounted === false) {
        if (pendingVotes.hasOwnProperty(userId)) {
            pendingVotes[userId].push({ vote: vote, image: challenge });
        } else {
            pendingVotes[userId] = [{ vote: vote, image: challenge }];
        }
    }

    const pendingVotesLength = pendingVotes[userId].length;
    log.info("Pending votes: ", pendingVotesLength);
    const imageData = pendingVotes[userId][0].image.split(";base64,").pop();
    const imageBuffer = Buffer.from(imageData!, "base64");
    const image = await Jimp.read(imageBuffer);
    const boxedImage = new Jimp(350, 350, 0xffffffff);
    const x = (350 - image.bitmap.width) / 2;
    const y = (350 - image.bitmap.height) / 2;
    boxedImage.composite(image, x, y);
    const boxedBuffer = await boxedImage.getBufferAsync(Jimp.MIME_JPEG);
    await plebbitFeedTgBot.telegram.sendPhoto(
        userId,
        {
            source: boxedBuffer,
        },
        {
            caption: `You have ${pendingVotesLength} pending votes. Please reply with the answer of the challenge`,
        }
    );
};
const sendChallengeVerificationMessage = async (
    userId: string,
    challengeVerification: any,
    vote: Vote
) => {
    log.info(inspect("Verifying challenge: ", challengeVerification, 2, false));
    if (!challengeVerification.challengeSuccess) {
        plebbitFeedTgBot.telegram.sendMessage(
            userId,
            "Challenge verification failed. Try again."
        );
    } else {
        plebbitFeedTgBot.telegram.sendMessage(
            userId,
            "Challenge verified successfully."
        );
    }
    vote.stop().catch((e) => log.error(e));
    vote.removeAllListeners("challenge");
    vote.removeAllListeners("challengeverification");
    vote.removeAllListeners("error");
    pendingVotes[userId].shift();
    if (pendingVotes[userId] && pendingVotes[userId].length > 0) {
        await sendChallengeMessage(
            userId,
            pendingVotes[userId][0].image,
            pendingVotes[userId][0].vote,
            true
        );
    }
};
const handlePublishChallengeAnswer = async (userId: string, answer: string) => {
    const vote = pendingVotes[userId][0].vote;
    try {
        await vote.publishChallengeAnswers([answer]);
    } catch (e) {
        log.error(e);
        if (pendingVotes[userId].length > 0) {
            vote.stop().catch((e) => log.error(e));
            vote.removeAllListeners("challenge");
            vote.removeAllListeners("challengeverification");
            vote.removeAllListeners("error");
            pendingVotes[userId].shift();
        }
    }
};

async function registerUser(userId: string): Promise<Signer | null> {
    try {
        const loadedSigner = await plebbitService.createSigner();
        if (!loadedSigner) {
            throw new Error("Error while creating signer");
        }
        const user = new User();
        user.id = userId;
        user.privateKey = loadedSigner.privateKey;
        await userService.createUser(user);
        return loadedSigner;
    } catch (e) {
        log.error(e);
        return null;
    }
}
async function loginUser(
    userId: string,
    privateKey: string
): Promise<Signer | null> {
    try {
        const loadedSigner = await plebbitService.loadSigner(privateKey);
        if (!loadedSigner) {
            throw new Error("Error while loading signer from private key");
        }
        const user = new User();
        user.id = userId;
        user.privateKey = loadedSigner.privateKey;
        await userService.createUser(user);
        return loadedSigner;
    } catch (e) {
        log.error(e);
        return null;
    }
}
export async function isUserRegistered(
    tgUserId: string
): Promise<User | false> {
    const user = await userService.getUser(tgUserId);
    log.info("User already registred as", user);
    if (user) {
        return user as User;
    }
    return false;
}

export async function startPlebgramBot(bot: Telegraf<Scenes.WizardContext>) {
    bot.start(async (ctx) => {
        log.info(ctx.message.from.username + " started the bot");
        if (!(await isUserRegistered(`${ctx.from!.id}`))) {
            await ctx.reply(
                `Welcome to Plebgram. Please register first. 
Use /register to create a new user or /login to use an existing user.
This process cannot be undone for now.`
            );
        } else {
            await ctx.reply("Welcome to Plebgram. You are already logged in");
        }
    });

    const store = Redis({ url: "redis://127.0.0.1:6379" }) as any;
    bot.use(session({ store }));
    log.info("storing sessions in redis");
    bot.use(stage.middleware());
    log.info("using middleware");
    // TODO: refactor this
    bot.action(/.+/, async (ctx) => {
        const vote = ctx.match[0] === "upvote" ? 1 : -1;
        const user = await isUserRegistered(`${ctx.from!.id}`);
        log.warn("User ", user, " is upvoting");
        try {
            await ctx.answerCbQuery(
                user
                    ? "Sending vote, please check @plebgrambot"
                    : `⚠️⚠️⚠️ start @plebgrambot ⚠️⚠️⚠️`
            );
            if (user) {
                await onVote(ctx, vote);
            }
        } catch (e) {
            log.error(e);
        }
    });

    bot.command("login", async (ctx) => {
        log.info(ctx.message.from.username + " asked for login");
        if (await isUserRegistered(`${ctx.message.chat.id}`)) {
            ctx.reply("You are already logged in");
            return;
        }
        log.info(ctx.message.from.username + " not logged in");
        await ctx.scene.enter("sceneLogin");
    });
    bot.command("register", async (ctx) => {
        log.info(ctx.message.from.username + " asked for register");
        if (await isUserRegistered(`${ctx.message.chat.id}`)) {
            ctx.reply("You are already logged in");
            return;
        }
        log.info(ctx.message.from.username + " not logged in");
        await ctx.scene.enter("sceneRegister");
    });
    bot.on(message("text"), async (ctx) => {
        log.info(ctx.message!.from.username + " sent a message");
        log.info(inspect(pendingVotes, false, 1));
        if (
            pendingVotes[ctx.message.from.id] &&
            pendingVotes[ctx.message.from.id].length > 0
        ) {
            await handlePublishChallengeAnswer(
                `${ctx.message.from.id}`,
                ctx.message.text
            );
            return;
        }
    });
}
function getSubPost(message: any) {
    const regexSub = /Subplebbit:\s*(.*)/;
    const regexPost = /\/c\/(.*)/;
    let sub = "";
    if ("caption" in message) {
        sub = message.caption.match(regexSub)[1];
    } else {
        sub = message.text.match(regexSub)[1];
    }
    log.info("Getting sub from message", sub);
    const splittedPostUrl =
        message.reply_markup.inline_keyboard[0][0].url.match(regexPost);
    log.info(splittedPostUrl);
    const post = splittedPostUrl[1];
    log.info("Getting post from message", post);
    return [sub, post];
}

const sceneRegister = new Scenes.WizardScene<Scenes.WizardContext>(
    "sceneRegister",
    async (ctx) => {
        const loadedSigner = await registerUser(`${ctx.from!.id}`);
        log.info(loadedSigner);
        if (!loadedSigner) {
            ctx.reply("Error. Try again later");
            return ctx.scene.leave();
        }
        await ctx.reply(`Signer loaded successfully, registeration complete
Address: ${loadedSigner.address}
Private key: ${loadedSigner.privateKey}
Public Key: ${loadedSigner.publicKey}
Short Address: ${loadedSigner.shortAddress}`);
        return ctx.scene.leave();
    }
);

const sceneLogin = new Scenes.WizardScene<Scenes.WizardContext>(
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
        if (privateKey === "/exit") {
            ctx.reply("Bye!");
            return ctx.scene.leave();
        }
        const loadedSigner = await loginUser(`${ctx.from!.id}`, privateKey);

        log.info(loadedSigner);
        if (!loadedSigner) {
            ctx.reply(
                "Error: Invalid private key. Try again or use /exit to leave",
                {
                    reply_markup: {
                        force_reply: true,
                    },
                }
            );
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
const stage = new Scenes.Stage<Scenes.WizardContext>([
    sceneLogin,
    sceneRegister,
]);
