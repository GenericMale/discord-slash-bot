import * as dotenv from 'dotenv';
import * as log4js from 'log4js';

import {Client, GuildMember, Message, TextChannel, WebhookClient, WSEventType} from 'discord.js';

import * as commandClasses from './commands';
import {CustomCommand} from './commands';
import {
    ApplicationCommandInteractionDataOption,
    Interaction,
    InteractionResponseType,
    InteractionType
} from './interaction';
import {Command, CommandOptions, CommandResponse} from './command';
import {ApplicationCommand} from './application-command';

dotenv.config();
log4js.configure({
    appenders: {
        out: {type: 'console'},
    },
    categories: {
        default: {appenders: ['out'], level: 'trace'},
    }
});
const log = log4js.getLogger();

process.on('uncaughtException', (err) => log.error(err));
process.on('unhandledRejection', (err) => log.error(err));

const client = new Client();
let commands: { [name: string]: Command };

client.on('debug', info => log.debug(info));
client.on('warn', info => log.warn(info));
client.on('ready', () => onClientReady());
client.ws.on('INTERACTION_CREATE' as WSEventType, interaction => onInteraction(interaction));

client.login(process.env.DISCORD_TOKEN).catch(reason => {
    log.error(`Discord login failed: ${reason}`);
});

async function onClientReady() {
    log.info('Discord client connected');

    commands = {};
    const classes = Object.values(commandClasses);

    let orphanCommands = await getGlobalCommands();
    for (const commandClass of classes) {
        const command: Command = new commandClass();
        await command.init(client);

        if (command.interaction) {
            commands[command.interaction.name] = command;

            await createGlobalCommand(command.interaction);
            orphanCommands = orphanCommands.filter(c => c.name !== command.interaction.name);
        } else {
            commands[`${commandClass.name}.class`] = command;
        }

        log.info(`Initialized ${commandClass.name}`);
    }

    //delete old commands
    for (const command of orphanCommands) {
        await deleteGlobalCommand(command.id);
        log.info(`Deleted ${command.name}`);
    }
}

async function onInteraction(interaction: Interaction) {
    if (interaction.type === InteractionType.ApplicationCommand) {
        await sendResponse(interaction, InteractionResponseType.Acknowledge);

        const guild = await client.guilds.fetch(interaction.guild_id);
        const channel = await client.channels.fetch(interaction.channel_id) as TextChannel;
        const member = new GuildMember(client, interaction.member, guild);
        const options = parseInteractionDataOption(interaction.data.options);
        const permissions = channel.permissionsFor(member);

        const command = commands[interaction.data.name];
        if (command) {
            if (!permissions.has(command.permission)) {
                return;
            }

            const response = await command.execute(options, member, channel);
            if (response) {
                return sendFollowup(interaction, response);
            }
        } else {
            if (!permissions.has('SEND_MESSAGES')) {
                return;
            }

            const command = commands['custom'] as CustomCommand;
            const response = await command.executeCommand(interaction.data.name, options, member);
            if (response) {
                return sendFollowup(interaction, response);
            }
        }
    } else {
        return sendResponse(interaction, InteractionResponseType.Pong);
    }
}

function parseInteractionDataOption(options?: ApplicationCommandInteractionDataOption[]) {
    const map: CommandOptions = {};
    if (options) {
        options.forEach(o => {
            if (o.options) {
                map[o.name] = parseInteractionDataOption(o.options);
            } else if (o.value) {
                map[o.name] = o.value;
            } else {
                map[o.name] = true;
            }
        });
    }
    return map;
}


async function sendFollowup(interaction: Interaction, data?: CommandResponse | string): Promise<Message> {
    const webhook = new WebhookClient(client.user.id, interaction.token);
    if(typeof data === 'string') {
        return webhook.send(data);
    } else {
        return webhook.send(data.content, {files: data.files, embeds: data.embeds});
    }
}

async function createGlobalCommand(config: ApplicationCommand): Promise<ApplicationCommand> {
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any).api.applications(client.user.id).commands.post({data: config});
}

async function getGlobalCommands(): Promise<ApplicationCommand[]> {
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any).api.applications(client.user.id).commands.get();
}

async function deleteGlobalCommand(id: string): Promise<Buffer> {
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any).api.applications(client.user.id).commands(id).delete();
}

async function sendResponse(interaction: Interaction, type: InteractionResponseType): Promise<Buffer> {
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any).api.interactions(interaction.id, interaction.token).callback.post({data: {type}});
}