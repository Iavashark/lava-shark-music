
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const play = require('play-dl');
const express = require('express');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PREFIX = "!";

play.getFreeClientID().then((clientID) => {
    play.setToken({
        spotify: {
            client_id: SPOTIFY_CLIENT_ID,
            client_secret: SPOTIFY_CLIENT_SECRET,
            market: 'US',
        },
        soundcloud: {
            client_id: clientID,
        },
        youtube: {
            cookie: process.env.YT_COOKIE
        }
    });
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

const queue = new Map();

client.once('ready', () => {
    console.log(`Bot آماده است! با نام ${client.user.tag} وارد شد.`);
});

const app = express();
app.get('/', (request, response) => {
  response.sendStatus(200);
});
app.listen(process.env.PORT || 3000);

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const serverQueue = queue.get(message.guild.id);

    if (command === 'play') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.channel.send('شما باید در یک کانال صوتی باشید تا موزیک پخش کنید!');
        }
        const permissions = voiceChannel.permissionsFor(message.client.user);
        if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
            return message.channel.send('من دسترسی لازم برای ورود و صحبت در این کانال صوتی را ندارم!');
        }
        if (!args.length) {
            return message.channel.send('لطفاً یک لینک یا نام موزیک وارد کنید!');
        }

        const query = args.join(' ');
        let songInfo;

        try {
            const searchResult = await play.search(query, {
                limit: 1,
                source: { youtube: 'video' }
            });

            if (searchResult.length === 0) {
                return message.channel.send('موزیکی با این نام پیدا نشد.');
            }
            songInfo = searchResult[0];

            if (!songInfo || !songInfo.url) {
                return message.channel.send(`متاسفانه نتوانستم لینک قابل پخشی برای "${query}" پیدا کنم.`);
            }

        } catch (error) {
            console.error(error);
            return message.channel.send('خطایی در جستجوی موزیک رخ داد.');
        }

        const song = {
            title: songInfo.title || 'Unknown Title',
            url: songInfo.url,
            duration: songInfo.durationRaw || 'N/A',
        };

        if (!serverQueue) {
            const queueContruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                songs: [],
                player: createAudioPlayer(),
                playing: true,
            };
            queue.set(message.guild.id, queueContruct);
            queueContruct.songs.push(song);

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
                queueContruct.connection = connection;
                
                await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                connection.subscribe(queueContruct.player);

                playSong(message.guild.id, queueContruct.songs[0]);
            } catch (err) {
                console.log(err);
                queue.delete(message.guild.id);
                return message.channel.send('خطا در اتصال به کانال صوتی.');
            }
        } else {
            serverQueue.songs.push(song);
            return message.channel.send(`**${song.title}** به صف اضافه شد!`);
        }
    } else if (command === 'skip') {
        if (!message.member.voice.channel) return message.channel.send('شما در کانال صوتی نیستید!');
        if (!serverQueue) return message.channel.send('صف پخشی وجود ندارد!');
        serverQueue.player.stop();
        message.channel.send('موزیک رد شد!');

    } else if (command === 'stop') {
        if (!message.member.voice.channel) return message.channel.send('شما در کانال صوتی نیستید!');
        if (!serverQueue) return message.channel.send('صف پخشی وجود ندارد!');
        serverQueue.songs = [];
        if (serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        queue.delete(message.guild.id);
        message.channel.send('پخش متوقف شد و صف پاک شد.');
    } else if (command === 'queue') {
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.channel.send('صف پخش خالی است.');
        }
        let queueMessage = `**درحال پخش:** ${serverQueue.songs[0].title}\n\n**صف پخش:**\n`;
        serverQueue.songs.slice(1).forEach((song, index) => {
            queueMessage += `${index + 1}. ${song.title}\n`;
        });
        message.channel.send(queueMessage);
    }
});

async function playSong(guildId, song) {
    const serverQueue = queue.get(guildId);
    if (!song) {
        if (serverQueue && serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        queue.delete(guildId);
        return;
    }

    try {
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        serverQueue.player.play(resource);
        
        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });

        serverQueue.textChannel.send(`درحال پخش: **${song.title}**`);

    } catch (error) {
        console.error(error);
        serverQueue.textChannel.send(`خطایی در هنگام پخش موزیک **${song.title}** رخ داد.`);
        serverQueue.songs.shift();
        playSong(guildId, serverQueue.songs[0]);
    }
}

client.login(DISCORD_TOKEN);
