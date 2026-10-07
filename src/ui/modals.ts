import { App, ButtonComponent, Modal, Setting } from 'obsidian';
import { longDate } from '../dates/format';
import { findDate } from '../dates/parse';
import type { TaskDate } from '../model/types';

export function confirmModal(app: App, title: string, message: string, cta: string, destructive = true, cancel = 'Cancel'): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.contentEl.createEl('p', { text: message });
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText(cancel).onClick(() => this.close()))
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

/** Asks for a date typed in words ("fri", "oct 20", "someday"), showing the date it reads. Null when cancelled. */
export function dateModal(app: App, today: string, weekStart: 0 | 1): Promise<TaskDate | null> {
	return new Promise((resolve) => {
		let picked: TaskDate | null = null;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle('Schedule');
				const input = this.contentEl.createEl('input', { type: 'text', placeholder: 'fri, next week, oct 20, someday', cls: 'pl-prompt-input' });
				const preview = this.contentEl.createDiv({ cls: 'pl-date-preview' });
				let button: ButtonComponent | null = null;
				const read = (): TaskDate | null => (input.value.trim() ? (findDate(input.value, today, weekStart)?.date ?? null) : null);
				const update = (): void => {
					const date = read();
					preview.setText(date ? longDate(date, today) : input.value.trim() ? 'Not a date Plainlist can read' : '');
					button?.setDisabled(!date);
				};
				const submit = (): void => {
					picked = read();
					if (picked) this.close();
				};
				input.addEventListener('input', update);
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.isComposing) submit();
				});
				new Setting(this.contentEl).addButton((b) => {
					button = b.setButtonText('Schedule').setCta().onClick(submit);
				});
				update();
				window.setTimeout(() => input.focus());
			}
			onClose(): void {
				this.contentEl.empty();
				resolve(picked);
			}
		})(app);
		modal.open();
	});
}
