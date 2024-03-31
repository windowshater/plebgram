import Plebbit from "@plebbit/plebbit-js";
import fs from "fs";
import { Markup, Scenes, Telegraf } from "telegraf";
import { log } from "../index.js";

const historyCidsFile = "history.json";
let processedCids: string[] = [];
loadOldPosts();

async function polling(
    address: string,
    tgBotInstance: Telegraf<Scenes.WizardContext>
) {
    if (!process.env.FEED_BOT_CHAT || !process.env.FEED_BOT_CHAT) {
        throw new Error("FEED_BOT_CHAT or BOT_TOKEN not set");
    }
    const plebbit = await Plebbit({
        ipfsGatewayUrls: ["https://rannithepleb.com/api/v0"],
        ipfsHttpClientsOptions: ["http://localhost:5001/api/v0"],
    });
    plebbit.on("error", (error) => {
        log.error(error);
    });
    const sub = await plebbit.createSubplebbit({
        address: address,
    });
    // will check if its a new post by looking the history file to send a new message
    sub.on("update", async (updatedSubplebbitInstance) => {
        loadOldPosts();
        if (
            updatedSubplebbitInstance.lastPostCid &&
            isNewPost(updatedSubplebbitInstance.lastPostCid)
        ) {
            processNewPost(updatedSubplebbitInstance.lastPostCid);
            const newPost = await plebbit.getComment(
                updatedSubplebbitInstance.lastPostCid
            );
            const postData = {
                title: newPost.title ? newPost.title : "",
                content: newPost.content ? newPost.content : "",
                postCid: newPost.postCid,
                link: newPost.link,
                cid: newPost.cid,
                subplebbitAddress: newPost.subplebbitAddress,
            };
            if (postData.title.length + postData.content.length > 900) {
                if (postData.title.length > 900) {
                    const truncated = postData.title.substring(0, 900);
                    postData.title =
                        truncated.substring(0, truncated.length - 3) + "...";
                    postData.content = "";
                } else {
                    const truncated = postData.content.substring(
                        0,
                        900 - postData.title.length
                    );
                    postData.content =
                        truncated.substring(0, truncated.length - 3) + "...";
                }
            }
            const captionMessage = `*${postData.title}*\n${postData.content}\n\nSubplebbit: [${newPost.subplebbitAddress}](https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress})`;
            const markupButtons = [
                [
                    Markup.button.url(
                        "View on Seedit",
                        `https://seedit.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}`
                    ),
                    Markup.button.url(
                        "View on Plebchan",
                        `https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}`
                    ),
                ],
                [
                    Markup.button.callback("-1", "downvote"),
                    Markup.button.callback("+1", "upvote"),
                ],
            ];

            if (postData.link) {
                tgBotInstance.telegram
                    .sendPhoto(process.env.FEED_BOT_CHAT!, postData.link, {
                        parse_mode: "Markdown",
                        caption: captionMessage,
                        ...Markup.inlineKeyboard(markupButtons),
                    })
                    .catch((error: any) => {
                        log.error(error);
                        // if the link is not a valid image, send the caption
                        tgBotInstance.telegram.sendMessage(
                            process.env.FEED_BOT_CHAT!,
                            captionMessage,
                            {
                                parse_mode: "Markdown",

                                ...Markup.inlineKeyboard(markupButtons),
                            }
                        );
                    });
            } else {
                tgBotInstance.telegram.sendMessage(
                    process.env.FEED_BOT_CHAT!,
                    captionMessage,
                    {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard(markupButtons),
                    }
                );
            }

            log.info("New post: ", postData);
        } else {
            log.info(
                "Post " + updatedSubplebbitInstance.lastPostCid,
                " already processed"
            );
        }
    });
    sub.update();
}
function isNewPost(postCid: string) {
    return !processedCids.includes(postCid);
}
function processNewPost(postCid: string) {
    processedCids.push(postCid);
    fs.writeFile(
        historyCidsFile,
        JSON.stringify({ Cids: processedCids }),
        "utf8",
        (err) => {
            if (err) {
                log.error("Error writing to file:", err);
                return;
            }

            log.info("Data has been written to the file.");
        }
    );
}
function loadOldPosts() {
    fs.readFile(historyCidsFile, "utf8", (err, data) => {
        if (err) {
            log.error("Error reading file:", err);
            return;
        }
        if (!!data) {
            const jsonData = JSON.parse(data);
            processedCids = jsonData.Cids;
        }
    });
}
// TODO: load subs from the git json
const subs: any = [
    "monarkia.eth",
    "weaponized-autism.eth",
    "plebtoken.eth",
    "pleblore.eth",
    "politically-incorrect.eth",
    "business-and-finance.eth",
    "movies-tv-anime.eth",
    "plebmusic.eth",
    "videos-livestreams-podcasts.eth",
    "health-nutrition-science.eth",
    "censorship-watch.eth",
    "reddit-screenshots.eth",
    "plebbit-italy.eth",
    "mktwallet.eth",
    "brasilandia.eth",
    "plebcouncil.eth",
    "plebpiracy.eth",
    "bitcoinbrothers.eth",
    "💩posting.eth",
    "plebbrothers.eth",
    "ripmy.eth",
    "technopleb.eth",
];
export function startPlebbitFeedBot(
    tgBotInstance: Telegraf<Scenes.WizardContext>
) {
    log.info("Starting plebbit feed bot");
    for (const sub of subs) {
        polling(sub, tgBotInstance);
    }
}
