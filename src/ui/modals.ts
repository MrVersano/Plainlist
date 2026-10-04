import { App, Modal, Setting } from 'obsidian';

export function confirmModal(app: App, title: string, message: string, cta: string, destructive = true): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.contentEl.createEl('p', { text: message });
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
					.addButton((b) => {
						b.setButtonText(cta).onClick(() => {
							answered = true;
							this.close();
						});
						if (destructive) b.setDestructive();
						else b.setCta();
					});
			}
			onClose(): void {
				this.contentEl.empty();
				resolve(answered);
			}
		})(app);
		modal.open();
	});
}

export function promptModal(app: App, title: string, placeholder: string, initial = '', cta = 'Create'): Promise<string | null> {
	return new Promise((resolve) => {
		let value = initial;
		let submitted = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				const input = this.contentEl.createEl('input', { type: 'text', placeholder, value: initial, cls: 'pl-prompt-input' });
				input.addEventListener('input', () => (value = input.value));
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.isComposing) {
						submitted = true;
						this.close();
					}
				});
				new Setting(this.contentEl).addButton((b) =>
					b
						.setButtonText(cta)
						.setCta()
						.onClick(() => {
							submitted = true;
							this.close();
						}),
				);
				window.setTimeout(() => input.select());
			}
			onClose(): void {
				this.contentEl.empty();
				resolve(submitted && value.trim() ? value.trim() : null);
			}
		})(app);
		modal.open();
	});
}
