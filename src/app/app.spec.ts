import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { MemoryRepository } from './core/memory-repository';
import { LEDGER_REPOSITORY } from './core/repository';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: LEDGER_REPOSITORY, useValue: new MemoryRepository() }],
    }).compileComponents();
  });

  it('creates the shell and waits for storage before showing screens', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });
});
