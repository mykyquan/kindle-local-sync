/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { createReviewActionButton } from "./ui/ReviewActionButton";

export class ExistingNotesWithoutDataModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private isReconnectPending = false;
	private reconnectFailed = false;
	private shouldFocusFailure = false;
	private reconnectButton: ButtonComponent | null = null;
	private cancelButton: ButtonComponent | null = null;

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.contentEl.addClass("kls-glass-scope");
		this.contentEl.addClass("kls-reconnect-modal");
		this.render();
	}

	close(): void {
		if (this.isReconnectPending) {
			return;
		}

		super.close();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Existing Kindle notes found" });
		const intro = this.contentEl.createEl("p", {
			text: "You can continue with these notes instead of starting over.",
		});
		intro.addClass("kls-reconnect-intro");
		this.renderReconnectFailure();

		const contentCard = this.createContentCard();
		const actions = contentCard.createDiv();

		actions.addClass("kls-button-row");
		actions.addClass("kls-reconnect-actions");

		this.reconnectButton = createReviewActionButton(
			actions,
			this.reconnectFailed ? "Try again" : "Continue with existing notes",
			"strong"
		);
		this.reconnectButton.onClick(async () => {
			await this.reconnect();
		});

		this.cancelButton = createReviewActionButton(actions, "Cancel", "subtle")
			.onClick(() => this.close());
	}

	private async reconnect(): Promise<void> {
		if (this.isReconnectPending || !this.reconnectButton) {
			return;
		}

		this.setReconnectPending(true);
		try {
			const reconnectCompleted = await this.plugin.continueExistingNotesWithoutDataSync();
			this.setReconnectPending(false);
			if (!reconnectCompleted) {
				return;
			}
			super.close();
		} catch (error) {
			console.error("Kindle note reconnect was not completed.", error);
			this.setReconnectPending(false);
			this.reconnectFailed = true;
			this.shouldFocusFailure = true;
			this.render();
		}
	}

	private setReconnectPending(pending: boolean): void {
		this.isReconnectPending = pending;
		this.reconnectButton?.setDisabled(pending);
		this.cancelButton?.setDisabled(pending);
		if (pending) {
			this.reconnectButton?.buttonEl.setAttribute("aria-busy", "true");
			this.contentEl.setAttribute("aria-busy", "true");
			return;
		}

		this.reconnectButton?.buttonEl.removeAttribute("aria-busy");
		this.contentEl.removeAttribute("aria-busy");
	}

	private renderReconnectFailure(): void {
		if (!this.reconnectFailed) {
			return;
		}

		const failureEl = this.contentEl.createDiv();

		failureEl.addClass("kls-operation-failure");
		failureEl.addClass("kls-reconnect-failure");
		failureEl.setAttribute("role", "alert");
		failureEl.setAttribute("tabindex", "-1");
		failureEl.createEl("h3", { text: "Couldn’t continue with these notes" });
		failureEl.createEl("p", {
			text: "We couldn’t save this step. Some note changes may already have been made, so try again to finish.",
		});

		if (this.shouldFocusFailure) {
			this.shouldFocusFailure = false;
			failureEl.focus({ preventScroll: true });
		}
	}

	private createContentCard(): HTMLElement {
		const card = this.contentEl.createDiv();
		const description = card.createDiv();

		card.addClass("kls-glass-card");
		card.addClass("kls-reconnect-card");
		description.addClass("kls-reconnect-description");
		description.createEl("p", {
			text: "Your notes will stay in place. Kindle Local Sync will recognize the highlights already there and only ask you to review the ones it doesn’t find.",
		});
		description.createEl("p", {
			text: "If you removed a highlight from a note but it is still in your Kindle file, choose Ignore during review to keep it from returning.",
		});

		return card;
	}
}
