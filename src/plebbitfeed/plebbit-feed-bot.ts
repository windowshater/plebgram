import Plebbit from "@plebbit/plebbit-js";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

const historyCidsFile = "history.json";
let processedCids = [];
loadOldPosts();

async function polling(address: string, tgBotInstance: TelegramBot) {
    const plebbit = await Plebbit();
    plebbit.on("error", console.log);
    const sub = await plebbit.createSubplebbit({
        address: address,
    });
    // will check if its a new post by looking the history file to send a new message
    sub.on("update", async (updatedSubplebbitInstance) => {
        loadOldPosts();
        if (isNewPost(updatedSubplebbitInstance.lastPostCid)) {
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
            const captionMessage = `*${postData.title}*\n${postData.content}\n\nSubplebbit: [${newPost.subplebbitAddress}](https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress})`;
            const replyMarkupMessage = {
                inline_keyboard: [
                    [
                        {
                            text: "View on Plebchan",
                            url: `https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}`,
                        },
                        {
                            text: "View on Seedit",
                            url: `https://seedit.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}`,
                        },
                    ],
                ],
            };
            if (newPost.link) {
                tgBotInstance
                    .sendPhoto(process.env.FEED_BOT_CHAT, postData.link, {
                        parse_mode: "Markdown",
                        caption: captionMessage,
                        reply_markup: replyMarkupMessage,
                    })
                    .catch((error) => {
                        console.log(error);
                        tgBotInstance.sendMessage(
                            process.env.FEED_BOT_CHAT,
                            captionMessage,
                            {
                                parse_mode: "Markdown",
                                reply_markup: replyMarkupMessage,
                            }
                        );
                    });
            } else {
                tgBotInstance.sendMessage(
                    process.env.FEED_BOT_CHAT,
                    captionMessage,
                    {
                        parse_mode: "Markdown",
                        reply_markup: replyMarkupMessage,
                    }
                );
            }

            console.log(postData);
        } else {
            console.log(
                "Post " + updatedSubplebbitInstance.lastPostCid,
                " already processed"
            );
        }
    });
    sub.update();
    setTimeout(() => {
        sub.stop();
        sub.update();
    }, 6000);
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
                console.error("Error writing to file:", err);
                return;
            }

            console.log("Data has been written to the file.");
        }
    );
}
function loadOldPosts() {
    fs.readFile(historyCidsFile, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading file:", err);
            return;
        }
        if (!!data) {
            const jsonData = JSON.parse(data);
            processedCids = jsonData.Cids;
        }
    });
}
// TODO: load subs from the git json
const subs = [
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
];
export function main(tgBotInstance: TelegramBot) {
    for (const sub of subs) {
        polling(sub, tgBotInstance);
    }
}
