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

// --- تنظیمات و توکن‌ها ---
const DISCORD_TOKEN = "MTM5NTE2OTUxNzQ5OTMyMjM5OA.GRzb8b.dzyYc9YLEGON5q5NicNsL3YGarkGjRV4V4NpS4"; // توکن بات دیسکورد خود را اینجا قرار دهید
const SPOTIFY_CLIENT_ID = "decb6d31c9244c0e88be710efee4e1b0"; // کلاینت آی‌دی اسپاتیفای
const SPOTIFY_CLIENT_SECRET = "6f268c5a2ed64b89a97c370e26e10e4a"; // کلاینت سکرت اسپاتیفای
const PREFIX = "!"; // پیشوند دستورات بات
// -------------------------

// تنظیمات اولیه play-dl برای اسپاتیفای و ساوندکلاود
play.getFreeClientID().then((clientID) => {
    play.setToken({
        spotify: {
            client_id: SPOTIFY_CLIENT_ID,
            client_secret: SPOTIFY_CLIENT_SECRET,
            market: 'US',
        },
        soundcloud: {
            client_id: clientID,
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

const queue = new Map(); // برای مدیریت صف موزیک هر سرور

client.once('ready', () => {
    console.log(`Bot آماده است! با نام ${client.user.tag} وارد شد.`);
});

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
            // ---- START: بخش اصلاح شده برای رفع خطا ----
            const searchResult = await play.search(query, {
                limit: 1,
                source: { youtube: 'video' } // این به پیدا کردن لینک قابل پخش کمک می‌کند
            });

            if (searchResult.length === 0) {
                return message.channel.send('موزیکی با این نام پیدا نشد.');
            }
            songInfo = searchResult[0];

            // بررسی حیاتی برای جلوگیری از خطای 'Invalid URL'
            if (!songInfo || !songInfo.url) {
                return message.channel.send(`متاسفانه نتوانستم لینک قابل پخشی برای "${query}" پیدا کنم.`);
            }
            // ---- END: بخش اصلاح شده ----

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

                // منتظر می‌مانیم تا اتصال پایدار شود
                await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                connection.subscribe(queueContruct.player);

                playSong(message.guild.id, queueContruct.songs[0]);
            } catch (err) {
                console.log(err);
                queue.delete(message.guild.id);
                return message.channel.send('خطا در اتصال به کانال صوتی. لطفاً دسترسی‌ها را چک کنید.');
            }
        } else {
            serverQueue.songs.push(song);
            return message.channel.send(`**${song.title}** به صف اضافه شد!`);
        }
    } else if (command === 'skip') {
        if (!message.member.voice.channel) return message.channel.send('شما در کانال صوتی نیستید!');
        if (!serverQueue) return message.channel.send('صف پخشی وجود ندارد!');

        serverQueue.player.stop(); // این کار آهنگ بعدی را به طور خودکار فعال می‌کند
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

// بخش مربوط به روشن نگه داشتن بات در Replit
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`Server is running on http://localhost:${port}`));

// استفاده از متغیر تعریف شده در بالای کد
client.login(DISCORD_TOKEN);
