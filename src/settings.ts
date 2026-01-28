import { App, PluginSettingTab, Setting } from "obsidian";
import type VrRpcServerPlugin from "./main";

export interface VrRpcSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: VrRpcSettings = {
	mySetting: "default",
};

export async function loadSettings(
	plugin: VrRpcServerPlugin,
): Promise<VrRpcSettings> {
	const data = (await plugin.loadData()) as Partial<VrRpcSettings>;
	return Object.assign({}, DEFAULT_SETTINGS, data);
}

export async function saveSettings(
	plugin: VrRpcServerPlugin,
	settings: VrRpcSettings,
): Promise<void> {
	await plugin.saveData(settings);
}

export class VrRpcSettingTab extends PluginSettingTab {
	plugin: VrRpcServerPlugin;

	constructor(app: App, plugin: VrRpcServerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Settings #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await saveSettings(this.plugin, this.plugin.settings);
					}),
			);
	}
}
