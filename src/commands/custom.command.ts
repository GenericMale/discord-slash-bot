import {ApplicationCommand, ApplicationCommandOption, ApplicationCommandOptionType} from '../application-command';
import {Command, CommandOptions, CommandResponse} from '../command';
import {Client, GuildMember, PermissionResolvable} from 'discord.js';
import * as log4js from 'log4js';
import * as path from 'path';
import {Database} from '../database';

const AUTHOR = '%author%';
const USER = '%user%';
const CHANNEL = '%channel%';
const ROLE = '%role%';

export class CustomCommand extends Command {

    interaction = {
        name: 'custom',
        description: 'Manage guild scoped custom commands',
        options: [
            {
                type: ApplicationCommandOptionType.SUB_COMMAND,
                name: 'add',
                description: 'Add a new guild command',
                options: [
                    {
                        type: ApplicationCommandOptionType.STRING,
                        name: 'name',
                        description: 'Name of the new command',
                        required: true
                    },
                    {
                        type: ApplicationCommandOptionType.STRING,
                        name: 'description',
                        description: 'Description for the new command',
                        required: true
                    },
                    {
                        type: ApplicationCommandOptionType.STRING,
                        name: 'text',
                        description: 'Text to be returned for the command. Allowed placeholders: ' + [AUTHOR, USER, CHANNEL, ROLE].join(' ')
                    },
                    {
                        type: ApplicationCommandOptionType.STRING,
                        name: 'attachment',
                        description: 'URL to a file (e.g. image) which should be attached to the message.'
                    }
                ]
            }, {
                type: ApplicationCommandOptionType.SUB_COMMAND,
                name: 'delete',
                description: 'Delete a guild command',
                options: [
                    {
                        type: ApplicationCommandOptionType.STRING,
                        name: 'name',
                        description: 'Name of the command to be deleted',
                        required: true
                    }
                ]
            }
        ]
    };
    permission: PermissionResolvable = 'ADMINISTRATOR';

    private readonly log = log4js.getLogger(CustomCommand.name);

    async execute(options, author): Promise<CommandResponse | string> {
        if (options.add) {
            return this.add(options.add, author);
        } else if (options.delete) {
            return this.delete(options.delete, author);
        }
    }

    private async add(options: CommandOptions, author: GuildMember): Promise<string> {
        let command: ApplicationCommand = await this.createGuildCommand(author.client, author.guild.id, {
            name: options.name as string,
            description: options.description as string,
            options: this.getCommandOptions(options.text as string)
        });

        let attachment;
        if (options.attachment) {
            attachment = await this.getDatabase(author).downloadFile(options.attachment as string);
        }

        let data = await this.getDatabase(author).readData();
        data[command.name] = {
            id: command.id,
            text: options.text,
            attachment: attachment,
            user: author.user.tag,
            added: new Date().toISOString(),
        };
        await this.getDatabase(author).writeData(data);

        this.log.info(`New custom command ${options.name} by ${author.user.tag}, total: ${data.length}`);
        return `New guild command "${options.name}" added by ${author.user.toString()}!`;
    }

    private getCommandOptions(text: string) {
        let commandOptions: ApplicationCommandOption[] = [];

        if (text) {
            if (text.includes(USER))
                commandOptions.push({
                    type: ApplicationCommandOptionType.USER,
                    name: 'user',
                    description: 'User to mention',
                    required: true
                });
            if (text.includes(CHANNEL))
                commandOptions.push({
                    type: ApplicationCommandOptionType.CHANNEL,
                    name: 'channel',
                    description: 'Channel to mention',
                    required: true
                });
            if (text.includes(ROLE))
                commandOptions.push({
                    type: ApplicationCommandOptionType.ROLE,
                    name: 'role',
                    description: 'Role to mention',
                    required: true
                });
        }

        return commandOptions;
    }

    private async delete(options: CommandOptions, author: GuildMember): Promise<string> {
        let data = await this.getDatabase(author).readData();

        let name = options.name as string;
        let command = data[name];
        if (!command) return;

        delete data[name];

        await this.getDatabase(author).writeData(data);
        await this.deleteGuildCommand(author.client, author.guild.id, command.id);

        this.log.info(`Custom command ${options.name} deleted by ${author.user.tag}, total: ${data.length}`);
        return `Guild command "${options.name}" removed by ${author.user.toString()}!`;
    }

    async executeCommand(name: string, options: CommandOptions, author: GuildMember): Promise<CommandResponse> {
        let data = await this.getDatabase(author).readData();
        let command = data[name];
        if (!command) return;

        return {
            content: this.getText(options, command.text, author),
            files: command.attachment ? [{
                attachment: command.attachment,
                name: command.name + path.extname(command.attachment),
            }] : undefined
        };
    }

    private getText(options: CommandOptions, text: string, author: GuildMember) {
        if (!text)
            return null;

        return text.replace(AUTHOR, author.toString())
            .replace(USER, `<@${options.user}>`)
            .replace(CHANNEL, `<#${options.channel}>`)
            .replace(ROLE, `<@&${options.role}>`);
    }

    private getDatabase(author: GuildMember) {
        return Database.get(CustomCommand, author.guild.id);
    }

    async createGuildCommand(client: Client, guild: string, config: ApplicationCommand): Promise<ApplicationCommand> {
        return (client as any).api.applications(client.user.id).guilds(guild).commands.post({data: config});
    }

    async deleteGuildCommand(client: Client, guild: string, id: string): Promise<Buffer> {
        return (client as any).api.applications(client.user.id).guilds(guild).commands(id).delete();
    }

}
