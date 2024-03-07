[![@plebgrambot](plebgramlogo.png =150x)](https://t.me/plebgrambot)

# plebgram

The **plebgram** project consists of a [Telegram bot](https://t.me/plebgrambot) to handle subplebbit interactions on telegram. It also work as a feed for new posts from the subplebbits [@plebbitfeed](https://t.me/plebbitfeed).

## Installation and local configuration

1. Clone this repo: `git clone https://github.com/windowshater/plebgram.git`
2. Install the dependencies: `npm install`
3. Setup the .env file
4. Run the bot: `npm run start`

## Enviroment variables

These must be set in a .env file inside the root directory

-   `BOT_TOKEN` - Your bot token
-   `FEED_BOT_CHAT` - The chat id of the feed **(the bot must be an admin there)**
