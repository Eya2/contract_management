import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { humanize, money } from './shared/format';

describe('App', () => {
  it('creates the root component', async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] }).compileComponents();
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });
});

describe('format helpers', () => {
  it('turns enum values into labels, keeping acronyms', () => {
    expect(humanize('UNDER_REVIEW')).toBe('Under review');
    expect(humanize('NDA')).toBe('NDA');
  });

  it('formats money and missing values', () => {
    expect(money('45000', 'USD')).toBe('$45,000.00');
    expect(money(null, 'USD')).toBe('—');
  });
});
