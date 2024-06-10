import * as fs from "fs";
import { Markup, Scenes, Telegraf } from "telegraf";
import { log, plebbit, plebbitFeedTgBot } from "../index.js";
import { Plebbit as PlebbitType } from "@plebbit/plebbit-js/dist/node/plebbit.js";
import fetch from "node-fetch";
import { RemoteSubplebbit } from "@plebbit/plebbit-js/dist/node/subplebbit/remote-subplebbit.js";
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 1 });
const historyCidsFile = "history.json";
let processedCids: any = {};

async function scrollPosts(
    address: string,
    tgBotInstance: Telegraf<Scenes.WizardContext>,
    plebbit: PlebbitType,
    subInstance: RemoteSubplebbit
) {
    log.info("Checking sub: ", address);
    try {
        log.info("Sub loaded");
        let currentPostCid = subInstance.lastPostCid;
        let counter = 0;
        while (currentPostCid && counter < 20) {
            counter += 1;
            if (!processedCids.Cids.includes(currentPostCid)) {
                const newPost = await plebbit.getComment(currentPostCid);
                const postData = {
                    title: newPost.title ? newPost.title : "",
                    content: newPost.content ? newPost.content : "",
                    postCid: newPost.postCid,
                    link: newPost.link,
                    cid: newPost.cid,
                    subplebbitAddress: newPost.subplebbitAddress,
                };
                postData.title = postData.title
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                postData.content = postData.content
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
                if (postData.title.length + postData.content.length > 900) {
                    if (postData.title.length > 900) {
                        const truncated = postData.title.substring(0, 900);
                        postData.title =
                            truncated.substring(0, truncated.length - 3) +
                            "...";
                        postData.content =
                            postData.content.substring(0, 900) + "...";
                    } else {
                        const truncated = postData.content.substring(
                            0,
                            900 - postData.title.length
                        );
                        postData.content =
                            truncated.substring(0, truncated.length - 3) +
                            "...";
                    }
                }
                const captionMessage = `<b>${postData.title}</b>\n${postData.content}\n\nSubmited on <a href="https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress}">p/${newPost.subplebbitAddress}</a> by ${newPost.author.address.includes(".") ? newPost.author.address : newPost.author.shortAddress}\n<a href="https://seedit.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}/">View on Seedit</a> | <a href="https://plebchan.eth.limo/#/p/${newPost.subplebbitAddress}/c/${newPost.postCid}/">View on Plebchan</a>`;

                if (postData.link) {
                    await queue.add(async () => {
                        tgBotInstance.telegram
                            .sendPhoto(
                                process.env.FEED_BOT_CHAT!,
                                postData.link!,
                                {
                                    parse_mode: "HTML",
                                    caption: captionMessage,
                                }
                            )
                            .then(() => {
                                processedCids.Cids.push(currentPostCid);
                            })
                            .catch((error: any) => {
                                log.error(error);
                                // if the link is not a valid image, send the caption
                                tgBotInstance.telegram
                                    .sendMessage(
                                        process.env.FEED_BOT_CHAT!,
                                        captionMessage,
                                        {
                                            parse_mode: "HTML",
                                        }
                                    )
                                    .then(() => {
                                        processedCids.Cids.push(currentPostCid);
                                    });
                            });

                        await new Promise((resolve) =>
                            setTimeout(resolve, 10 * 1000)
                        );
                    });
                } else {
                    await queue.add(async () => {
                        tgBotInstance.telegram
                            .sendMessage(
                                process.env.FEED_BOT_CHAT!,
                                captionMessage,
                                {
                                    parse_mode: "HTML",
                                }
                            )
                            .then(() => {
                                processedCids.Cids.push(currentPostCid);
                            });
                        await new Promise((resolve) =>
                            setTimeout(resolve, 10 * 1000)
                        );
                    });
                }
                log.info("New post: ", postData);
                currentPostCid = newPost.previousCid;
            } else {
                //log.info("Already processsed: ", currentPostCid);
                const post = await plebbit.getComment(currentPostCid);
                currentPostCid = post.previousCid;
            }
        }
    } catch (e) {
        log.error(e);
    }
    log.info("Finished on ", address);
}

function loadOldPosts() {
    try {
        const data = fs.readFileSync(historyCidsFile, "utf8");
        processedCids = JSON.parse(data);
    } catch (error) {
        log.error(error);
        throw new Error();
    }
}
function savePosts() {
    try {
        fs.writeFileSync(
            historyCidsFile,
            JSON.stringify(processedCids, null, 2),
            "utf8"
        );
    } catch (error) {
        log.error("Error saving json file");
    }
}

export async function startPlebbitFeedBot(
    tgBotInstance: Telegraf<Scenes.WizardContext>
) {
    log.info("Starting plebbit feed bot");

    if (!process.env.FEED_BOT_CHAT || !process.env.FEED_BOT_CHAT) {
        throw new Error("FEED_BOT_CHAT or BOT_TOKEN not set");
    }
    while (true) {
        loadOldPosts();
        console.log("Length of loaded posts: ", processedCids.Cids.length);
        const subs = await fetchSubs();
        await Promise.all(
            subs.map(async (subAddress: string) => {
                try {
                    log.info("Loading sub ", subAddress);
                    const startTime = performance.now();
                    const subInstance: any = await Promise.race([
                        plebbit.getSubplebbit(subAddress),
                        new Promise((_, reject) => {
                            setTimeout(
                                () => {
                                    reject(
                                        new Error(
                                            "Operation timed out after 5 minutes"
                                        )
                                    );
                                },
                                5 * 60 * 1000
                            );
                        }),
                    ]);
                    const endTime = performance.now();
                    log.info("Time to load sub: ", endTime - startTime);
                    if (subInstance.address) {
                        await Promise.race([
                            scrollPosts(
                                subInstance.address,
                                tgBotInstance,
                                plebbit,
                                subInstance
                            ),
                            new Promise((_, reject) => {
                                setTimeout(
                                    () => {
                                        reject(
                                            new Error(
                                                "Timedout after 6 minutes of post crawling on " +
                                                    subInstance.address
                                            )
                                        );
                                    },
                                    6 * 60 * 1000
                                );
                            }),
                        ]);
                    }
                } catch (e) {
                    log.info(e);
                    log.info(subAddress);
                }
            })
        );
        log.info("saving new posts");
        savePosts();
    }
}

export async function fetchSubs() {
    let subs = [];
    try {
        const response = await fetch(
            "https://raw.githubusercontent.com/plebbit/temporary-default-subplebbits/master/multisub.json"
        );
        if (!response.ok) {
            throw new Error("Failed to fetch subs");
        } else {
            const data: any = await response.json();

            subs = data.subplebbits.map((obj: any) => obj.address);
        }
    } catch (error) {
        log.error("Error:", error);
    }
    return subs;
}
