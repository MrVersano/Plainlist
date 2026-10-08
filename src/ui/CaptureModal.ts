import { App, Modal, Scope } from 'obsidian';
import { h, render } from 'preact';
import { type CaptureOptions, startCapture } from '../capture';
import { Capture } from './components/Capture';
import { noteLinks } from './obsidian';

export interface CaptureModalExtras {
	/** Text to start the palette with. */
	initialText?: string;
	/** Called once the palette closes, saying whether it saved a to-do. */
	onDone?: (saved: boolean) => void;
}

/** The "New to-do" palette. Writes straight to the notes, so it works with the view closed. */
export class CaptureModal extends Modal {
	private saved = false;
	/** Set by the palette: closes an open project list, returning false when none was open. */
	private closeList: { current: (() => boolean) | null } = { current: null };

	constructor(
		app: App,
		private options: CaptureOptions,
		private extras: CaptureModalExtras = {},
	) {
		super(app);
		// Obsidian handles Escape before the palette sees it. Replace its handler so that,
		// with a project list open, Escape closes the list and not the palette.
		this.scope = new Scope();
		this.scope.register([], 'Escape', () => {
			if (!this.closeList.current?.()) this.close();
			return false;
		});
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass('pl-capture-modal');
		this.containerEl.addClass('pl-capture-container');
		const session = await startCapture(this.app, this.options);
		const { today, weekStart, defaultDate } = this.options;
		render(
			h(Capture, {
				today,
				weekStart,
				projects: session.projects,
				initialProject: session.initialProject,
				initialHeading: session.initialHeading,
				defaultDate,
				initialText: this.extras.initialText,
				links: noteLinks(this.app, this.options.file.path),
				closeList: this.closeList,
				onSave: async (result) => {
					const ok = await session.save(result);
					if (ok) this.saved = true;
					return ok;
				},
				onClose: () => this.close(),
			}),
			this.contentEl,
		);
	}

	onClose(): void {
		render(null, this.contentEl);
		this.extras.onDone?.(this.saved);
	}
}
