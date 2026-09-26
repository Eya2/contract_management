import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { lang, t } from './i18n';

/** Route titles are English keys; this shows them translated and re-applies them when the language changes. */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private current: string | undefined;

  constructor() {
    super();
    effect(() => {
      lang();
      if (this.current) this.title.setTitle(t(this.current));
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot) {
    this.current = this.buildTitle(snapshot);
    if (this.current) this.title.setTitle(t(this.current));
  }
}

