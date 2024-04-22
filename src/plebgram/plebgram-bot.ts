import { Markup, Scenes, Telegraf, session } from "telegraf";
import { UserService } from "../services/user.service.js";
import { Redis } from "@telegraf/session/redis";
import { PlebbitService } from "../services/plebbit.service.js";
import { User } from "../models/user.js";
import { Signer } from "@plebbit/plebbit-js/dist/node/signer/index.js";
import { log, plebbit, plebbitFeedTgBot } from "../index.js";
import Vote from "@plebbit/plebbit-js/dist/node/vote.js";
import { message } from "telegraf/filters";
import { inspect } from "util";
import Jimp from "jimp";
import { MessageService } from "../services/message.service.js";
import { Comment } from "@plebbit/plebbit-js/dist/node/comment.js";
import Author from "@plebbit/plebbit-js/dist/node/author.js";

const userService = new UserService();
const messageService = new MessageService();
const plebbitService = new PlebbitService();

const pendings: {
    [key: string]: { pendingObject: Vote | Comment; image: string }[];
} = {};
const onComment = async (ctx: any) => {
    log.info(inspect(pendings, false, 1));
    const signer = await getSignerFromTelgramUserId(`${ctx.message.from!.id}`);
    if (!signer) {
        return;
    }

    let replyCid = "";
    let sub = "";
    let replyToReply = "";
    if (ctx.message.reply_to_message.hasOwnProperty("entities")) {
        log.info("message directly pointing to post");
        log.info(ctx.message.reply_to_message.entities);
        [sub, replyCid] = getSubPost(
            ctx.message.reply_to_message.entities[0].url
        );
    } else {
        // look in the reply thread if the original message is a post in plebgram
        let repliedPost = await messageService.getMessage(
            `${ctx.message.reply_to_message.message_id}`
        );
        log.info("loaded message ", repliedPost.message_id);
        while (repliedPost) {
            if (repliedPost.hasOwnProperty("cid")) {
                replyToReply = repliedPost.cid;
            }
            // check if it is replying to something
            if (repliedPost.hasOwnProperty("reply_to_message")) {
                if (repliedPost.reply_to_message.hasOwnProperty("entities")) {
                    log.info("original post found");
                    [sub, replyCid] = getSubPost(
                        repliedPost.reply_to_message.entities[0].url
                    );
                    break;
                } else {
                    // crawling to upper message
                    repliedPost = await messageService.getMessage(
                        `${repliedPost.reply_to_message.message_id}`
                    );

                    log.info("loaded message ", repliedPost.message_id);
                }
            } else {
                log.warn("original post not found, message ignored");
                return;
            }
        }
    }
    log.info("Post cid captured, lets create the comment");
    log.info(replyCid);
    plebbitFeedTgBot.telegram.sendMessage(ctx.from.id!, "Creating request");
    const newComment = await plebbit.createComment({
        signer: signer,
        parentCid: replyToReply != "" ? replyToReply : replyCid,
        content: `${ctx.message.text}`,
        subplebbitAddress: sub,
        author: {
            address: signer.address,
            shortAddress: signer.shortAddress,
        },
    });
    newComment.on("challenge", (challengeMessage) => {
        log.info("Challenge received");
        sendChallengeMessage(
            `${ctx.from!.id}`,
            challengeMessage.challenges[0].challenge,
            newComment,
            false
        );
    });
    newComment.on(
        "challengeverification",
        async (challengeVerification: any) => {
            log.info("Verifying challenge answer");
            sendChallengeVerificationMessage(
                `${ctx.from!.id}`,
                challengeVerification,
                newComment,
                ctx
            );
            if (challengeVerification.challengeSuccess) {
                const message = await messageService.getMessage(
                    `${ctx.message.message_id}`
                );
                message.cid = challengeVerification.publication.cid;
                await messageService.editMessage(message);
            }
        }
    );
    newComment.on("error", (err) => {
        // this should destroy the vote if no challenge is received
        sendErrorMessage(`${ctx.from!.id}`, err);
        newComment.stop().catch((e) => log.error(e));
        newComment.removeAllListeners("challenge");
        newComment.removeAllListeners("challengeverification");
        newComment.removeAllListeners("error");
    });
    await newComment.publish();

    //replyCid = "thisIsATest";
    //const message = await messageService.getMessage(
    //    `${ctx.message.message_id}`
    //);
    //message.cid = replyCid;
    //await messageService.editMessage(message);
};

const onVote = async (ctx: any, vote: 1 | -1) => {
    log.info(inspect(pendings, false, 1));
    const signer = await getSignerFromTelgramUserId(`${ctx.from!.id}`);
    const [sub, post] = getSubPost(
        ctx.update.callback_query.message.reply_markup.inline_keyboard[0][1].url
    );
    if (!signer) {
        ctx.answerCbQuery("⚠️⚠️⚠️ start @plebgrambot ⚠️⚠️⚠️");
        return;
    }
    plebbitFeedTgBot.telegram.sendMessage(ctx.from.id!, "Creating request...");
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
    newVote.on("challengeverification", (challengeVerification: any) => {
        log.info("Verifying challenge answer");
        sendChallengeVerificationMessage(
            `${ctx.from!.id}`,
            challengeVerification,
            newVote,
            ctx
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
    pendingObject: Vote | Comment,
    alreadyCounted: boolean
) => {
    if (alreadyCounted === false) {
        if (pendings.hasOwnProperty(userId)) {
            pendings[userId].push({
                pendingObject: pendingObject,
                image: challenge,
            });
        } else {
            pendings[userId] = [
                { pendingObject: pendingObject, image: challenge },
            ];
        }
    }

    const pendingsLength = pendings[userId].length;
    log.info("Pendings: ", pendingsLength);
    const imageData = pendings[userId][0].image.split(";base64,").pop();
    const imageBuffer = Buffer.from(imageData!, "base64");
    const image = await Jimp.read(imageBuffer);
    const boxedImage = new Jimp(350, 350, 0xffffffff);
    const x = (350 - image.bitmap.width) / 2;
    const y = (350 - image.bitmap.height) / 2;
    boxedImage.composite(image, x, y);
    const boxedBuffer = await boxedImage.getBufferAsync(Jimp.MIME_JPEG);
    try {
        await plebbitFeedTgBot.telegram.sendPhoto(
            userId,
            {
                source: boxedBuffer,
            },
            {
                caption: `You have ${pendingsLength} pending challenges. Please reply with the answer of the challenge`,
                ...Markup.inlineKeyboard([
                    Markup.button.callback("Cancel", "cancel"),
                ]),
            }
        );
    } catch (e: any) {
        sendErrorMessage(userId, e.message);
    }
};
const sendChallengeVerificationMessage = async (
    userId: string,
    challengeVerification: any,
    pendingObject: Vote | Comment,
    ctx: any
) => {
    pendingObject.stop().catch((e) => log.error(e));
    pendingObject.removeAllListeners("challenge");
    pendingObject.removeAllListeners("challengeverification");
    pendingObject.removeAllListeners("error");
    if (pendings[userId].length > 0) {
        pendings[userId].shift();
    }
    log.info(inspect("Verifying challenge: ", challengeVerification, 2, false));
    if (!challengeVerification.challengeSuccess) {
        if (pendingObject instanceof Comment) {
            plebbitFeedTgBot.telegram.sendMessage(
                userId,
                "Challenge verification failed. Recreating challenge..."
            );
            await onComment(ctx);
        } else {
            plebbitFeedTgBot.telegram.sendMessage(
                userId,
                "Challenge verification failed. Try again."
            );
        }
    } else {
        plebbitFeedTgBot.telegram.sendMessage(
            userId,
            "Challenge verified successfully."
        );
    }

    if (pendings[userId] && pendings[userId].length > 0) {
        await sendChallengeMessage(
            userId,
            pendings[userId][0].image,
            pendings[userId][0].pendingObject,
            true
        );
    }
};
const handlePublishChallengeAnswer = async (userId: string, answer: string) => {
    const pending = pendings[userId][0].pendingObject;
    try {
        await pending.publishChallengeAnswers([answer]);
    } catch (e) {
        log.error(e);
        if (pendings[userId].length > 0) {
            pending.stop().catch((e) => log.error(e));
            pending.removeAllListeners("challenge");
            pending.removeAllListeners("challengeverification");
            pending.removeAllListeners("error");
            pendings[userId].shift();
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
    //    bot.start(async (ctx) => {
    //        log.info(ctx.message.from.username + " started the bot");
    //        if (!(await isUserRegistered(`${ctx.from!.id}`))) {
    //            await ctx.reply(
    //                `Welcome to Plebgram. Please register first.
    //Use /register to create a new user or /login to use an existing user.
    //This process cannot be undone for now.`
    //            );
    //        } else {
    //            await ctx.reply("Welcome to Plebgram. You are already logged in");
    //        }
    //    });

    const store = Redis({ url: "redis://127.0.0.1:6379" }) as any;
    bot.use(session({ store }));
    log.info("storing sessions in redis");
    bot.use(stage.middleware());
    log.info("using middleware");
    // TODO: refactor this
    bot.action(/.+/, async (ctx) => {
        // destroy the pending request by pressing the cancel button
        if (ctx.match[0] === "cancel") {
            ctx.answerCbQuery("Destroying request...");
            const userId = `${ctx.from.id}`;
            if (pendings[userId].length > 0) {
                const pendingObject =
                    pendings[userId][pendings[userId].length - 1].pendingObject;
                pendingObject.stop().catch((e) => log.error(e));
                pendingObject.removeAllListeners("challenge");
                pendingObject.removeAllListeners("challengeverification");
                pendingObject.removeAllListeners("error");
                pendings[userId].shift();
                plebbitFeedTgBot.telegram.sendMessage(
                    ctx.from.id!,
                    "Request destroyed"
                );
                if (pendings[userId] && pendings[userId].length > 0) {
                    await sendChallengeMessage(
                        userId,
                        pendings[userId][0].image,
                        pendings[userId][0].pendingObject,
                        true
                    );
                }
            }
        } else {
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
        }
    });

    //bot.command("login", async (ctx) => {
    //    log.info(ctx.message.from.username + " asked for login");
    //    if (await isUserRegistered(`${ctx.message.chat.id}`)) {
    //        ctx.reply("You are already logged in");
    //        return;
    //    }
    //    log.info(ctx.message.from.username + " not logged in");
    //    await ctx.scene.enter("sceneLogin");
    //});
    bot.start(async (ctx) => {
        if (ctx.message.chat.id == ctx.message.from.id) {
            log.info(ctx.message.from.username + " asked for register");
            if (await isUserRegistered(`${ctx.message.chat.id}`)) {
                ctx.reply("You are already logged in");
                return;
            }
            log.info(ctx.message.from.username + " not logged in");
            await ctx.scene.enter("sceneRegister");
        }
    });
    bot.on(message("text"), async (ctx) => {
        if (String(ctx.from.id) == process.env.CHAT_BOT_ID!) {
            return;
        }
        log.info(ctx.message!.from.username + " sent a message");
        log.info(inspect(pendings, false, 1));
        if (ctx.message.chat.id == ctx.message.from.id) {
            if (
                pendings[ctx.message.from.id] &&
                pendings[ctx.message.from.id].length > 0 &&
                ctx.message.chat.id == ctx.message.from.id
            ) {
                await handlePublishChallengeAnswer(
                    `${ctx.message.from.id}`,
                    ctx.message.text
                );
                return;
            }
        } else {
            if (
                ctx.message.chat.id == Number(process.env.COMMENT_CHAT)! &&
                ctx.message.hasOwnProperty("reply_to_message")
            ) {
                const user = await isUserRegistered(`${ctx.message.from.id}`);
                if (user) {
                    // the user must me registered and the message must be from the comment
                    // chat to have the message saved
                    try {
                        log.info("User ", user, " is commmenting");
                        log.info(ctx.message);
                        await messageService.createMessage(ctx.message);
                        await onComment(ctx);
                    } catch (e) {
                        log.error(e);
                    }
                }
            }
        }
    });
}
function getSubPost(url: string) {
    log.info(url);
    const regexSub = /\/p\/([^/]+)/;
    const regexPost = /\/c\/([^/]+)/;
    const subMatch = url.match(regexSub);
    const postMatch = url.match(regexPost);
    const sub = subMatch![1];
    const post = postMatch![1];
    return [sub, post];
    //let sub = "";
    //if ("caption" in message) {
    //    sub = message.caption.match(regexSub)[1];
    //} else {
    //    sub = message.text.match(regexSub)[1];
    //}
    //log.info("Getting sub from message", sub);
    //const splittedPostUrl =
    //    message.reply_markup.inline_keyboard[0][0].url.match(regexPost);
    //log.info(splittedPostUrl);
    //const post = splittedPostUrl[1];
    //log.info("Getting post from message", post);
    //return [sub, post];
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
