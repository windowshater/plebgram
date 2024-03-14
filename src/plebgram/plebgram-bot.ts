import { Context, Markup, Scenes, Telegraf, session } from "telegraf";
import { UserService } from "../services/user.service.js";
import { Redis } from "@telegraf/session/redis";
import { PlebbitService } from "../services/plebbit.service.js";
import { User } from "../models/user.js";
import { Signer } from "@plebbit/plebbit-js/dist/node/signer/index.js";
import { log } from "../index.js";
import { message } from "telegraf/filters";
import { PlebbitError } from "@plebbit/plebbit-js/dist/node/plebbit-error.js";
import Plebbit from "@plebbit/plebbit-js";
const plebbit = await Plebbit({
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
    bot.action("requestRemoveVote", async (ctx) => {
        ctx.editMessageReplyMarkup({
            inline_keyboard: [[]],
        });
        try {
            log.info(ctx.update.callback_query.message!);
            const user = await isUserRegistered(`${ctx.from!.id}`);
            if (!user) {
                return ctx.answerCbQuery(
                    `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
                );
            }
            const loadedSigner = await plebbitService.loadSigner(
                user!.privateKey!
            );
            const regex = /Post: (.+)/;
            const match =
                "text" in ctx.update.callback_query.message!
                    ? ctx.update.callback_query.message!.text.match(regex)
                    : ["", ""];
            log.info(match![1]);

            const post = await plebbit.getComment(match![1]);
            const sub = post.subplebbitAddress;
            const vote = await plebbit.createVote({
                signer: loadedSigner!,
                commentCid: post.cid!,
                subplebbitAddress: sub,
                vote: 0,
            });
            log.info(vote.toJSON());
            vote.on("challenge", async (challengeMessage) => {
                log.info("Challenge received");
                const imageData = challengeMessage.challenges[0].challenge;
                const answer = await askForChallengeAnswers(
                    ctx,
                    imageData,
                    bot
                );
                vote.publishChallengeAnswers([answer]);
                ctx.reply("Sending answer...");
            });
            vote.on("challengeverification", (challengeMessage, _vote) => {
                log.info("Challenge received");
                if (!challengeMessage.challengeSuccess) {
                    console.log("Challenge verification failed, try again");
                    return ctx.reply("Challenge verification failed");
                } else {
                    console.log("Challenge verified");
                    return ctx.reply("Challenge verified");
                }
            });
            log.info("Waiting for challenge");
            ctx.reply("Waiting for challenge...");
            await vote.publish();
        } catch (e: any) {
            const error: PlebbitError = e;
            log.error(e);
            ctx.reply("Error on getting challenge: " + error.toString());
        }
    });
    bot.action("requestDownvote", async (ctx) => {
        ctx.editMessageReplyMarkup({
            inline_keyboard: [[]],
        });
        try {
            log.info(ctx.update.callback_query.message!);
            const user = await isUserRegistered(`${ctx.from!.id}`);
            if (!user) {
                return ctx.answerCbQuery(
                    `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
                );
            }
            const loadedSigner = await plebbitService.loadSigner(
                user!.privateKey!
            );
            const regex = /Post: (.+)/;
            const match =
                "text" in ctx.update.callback_query.message!
                    ? ctx.update.callback_query.message!.text.match(regex)
                    : ["", ""];
            log.info(match![1]);

            const post = await plebbit.getComment(match![1]);
            const sub = post.subplebbitAddress;
            const vote = await plebbit.createVote({
                signer: loadedSigner!,
                commentCid: post.cid!,
                subplebbitAddress: sub,
                vote: -1,
            });
            log.info(vote.toJSON());
            vote.on("challenge", async (challengeMessage) => {
                log.info("Challenge received");
                const imageData = challengeMessage.challenges[0].challenge;
                const answer = await askForChallengeAnswers(
                    ctx,
                    imageData,
                    bot
                );
                vote.publishChallengeAnswers([answer]);
                ctx.reply("Sending answer...");
            });
            vote.on("challengeverification", (challengeMessage, _vote) => {
                log.info("Challenge received");
                if (!challengeMessage.challengeSuccess) {
                    console.log("Challenge verification failed, try again");
                    return ctx.reply("Challenge verification failed");
                } else {
                    console.log("Challenge verified");
                    return ctx.reply("Challenge verified");
                }
            });
            log.info("Waiting for challenge");
            ctx.reply("Waiting for challenge...");
            await vote.publish();
        } catch (e: any) {
            const error: PlebbitError = e;
            log.error(e);
            ctx.reply("Error on getting challenge: " + error.toString());
        }
    });
    bot.action("requestUpvote", async (ctx) => {
        ctx.editMessageReplyMarkup({
            inline_keyboard: [[]],
        });
        try {
            log.info(ctx.update.callback_query.message!);
            const user = await isUserRegistered(`${ctx.from!.id}`);
            if (!user) {
                return ctx.answerCbQuery(
                    `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
                );
            }
            const loadedSigner = await plebbitService.loadSigner(
                user!.privateKey!
            );
            const regex = /Post: (.+)/;
            const match =
                "text" in ctx.update.callback_query.message!
                    ? ctx.update.callback_query.message!.text.match(regex)
                    : ["", ""];
            log.info(match![1]);

            const post = await plebbit.getComment(match![1]);
            const sub = post.subplebbitAddress;
            const vote = await plebbit.createVote({
                signer: loadedSigner!,
                commentCid: post.cid!,
                subplebbitAddress: sub,
                vote: 1,
            });
            log.info(vote.toJSON());
            vote.on("challenge", async (challengeMessage) => {
                log.info("Challenge received");
                const imageData = challengeMessage.challenges[0].challenge;
                const answer = await askForChallengeAnswers(
                    ctx,
                    imageData,
                    bot
                );
                vote.publishChallengeAnswers([answer]);
                ctx.reply("Sending answer...");
            });
            vote.on("challengeverification", (challengeMessage, _vote) => {
                log.info("Challenge received");
                if (!challengeMessage.challengeSuccess) {
                    console.log("Challenge verification failed, try again");
                    return ctx.reply("Challenge verification failed");
                } else {
                    console.log("Challenge verified");
                    return ctx.reply("Challenge verified");
                }
            });
            log.info("Waiting for challenge");
            ctx.reply("Waiting for challenge...");
            await vote.publish();
        } catch (e: any) {
            const error: PlebbitError = e;
            log.error(e);
            ctx.reply("Error on getting challenge: " + error.toString());
        }
    });
    bot.action("removeVote", async (ctx) => {
        const user = await isUserRegistered(`${ctx.from!.id}`);
        log.warn("User ", user, " is downvoting");
        try {
            await ctx.answerCbQuery(
                user
                    ? "Sending vote, please check @plebgrambot"
                    : `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
            );
            if (user) {
                const [sub, post] = getSubPost(
                    ctx.update.callback_query.message
                );
                await ctx.telegram.sendMessage(
                    `${ctx.from!.id}`,
                    `You created a remove vote request for:
Subplebbit: ${sub}
Post: \`\`\`${post}\`\`\`
`,
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    Markup.button.callback(
                                        "Request remove vote",
                                        "requestRemoveVote"
                                    ),
                                ],
                            ],
                        },
                    }
                );
                log.info(
                    "caption" in ctx.update.callback_query.message!
                        ? ctx.update.callback_query.message!.caption
                        : ""
                );
            }
        } catch (e) {
            log.error(e);
        }
    });
    bot.action("downvote", async (ctx) => {
        const user = await isUserRegistered(`${ctx.from!.id}`);
        log.warn("User ", user, " is downvoting");
        try {
            await ctx.answerCbQuery(
                user
                    ? "Sending vote, please check @plebgrambot"
                    : `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
            );
            if (user) {
                const [sub, post] = getSubPost(
                    ctx.update.callback_query.message
                );
                await ctx.telegram.sendMessage(
                    `${ctx.from!.id}`,
                    `You created a downvote request for:
Subplebbit: ${sub}
Post: \`\`\`${post}\`\`\`
`,
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    Markup.button.callback(
                                        "Request downvote",
                                        "requestDownvote"
                                    ),
                                ],
                            ],
                        },
                    }
                );
                log.info(
                    "caption" in ctx.update.callback_query.message!
                        ? ctx.update.callback_query.message!.caption
                        : ""
                );
            }
        } catch (e) {
            log.error(e);
        }
    });
    bot.action("upvote", async (ctx) => {
        const user = await isUserRegistered(`${ctx.from!.id}`);
        log.warn("User ", user, " is upvoting");
        try {
            await ctx.answerCbQuery(
                user
                    ? "Sending vote, please check @plebgrambot"
                    : `Error on ${ctx.match[0]}. You are not registered yet. Please go to @plebgrambot to register`
            );
            if (user) {
                const [sub, post] = getSubPost(
                    ctx.update.callback_query.message
                );
                await ctx.telegram.sendMessage(
                    `${ctx.from!.id}`,
                    `You created a upvote request for:
Subplebbit: ${sub}
Post: \`\`\`${post}\`\`\`
`,
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    Markup.button.callback(
                                        "Request upvote",
                                        "requestUpvote"
                                    ),
                                ],
                            ],
                        },
                    }
                );
                log.info(
                    "caption" in ctx.update.callback_query.message!
                        ? ctx.update.callback_query.message!.caption
                        : ""
                );
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
async function askForChallengeAnswers(
    ctx: Context,
    image: string,
    bot: Telegraf<Scenes.WizardContext>
) {
    return new Promise<string>((resolve) => {
        const imageData = image.split(";base64,").pop();
        const imageBuffer = Buffer.from(imageData!, "base64");
        ctx.replyWithPhoto(
            {
                source: imageBuffer,
            },
            {
                caption: "Reply with the answer of the challenge",
                reply_markup: {
                    force_reply: true,
                },
            }
        );
        bot.on(message("text"), async (ctx) => {
            if (ctx.chat.id === ctx.from.id) {
                resolve(ctx.text || "");
            }
        });
    });
}
