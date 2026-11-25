import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { KINDS, SIZES } from '../core/catalog';
import { group, parseCount } from '../core/format';
import { I18n } from '../core/i18n';
import { Brand, Cat, Kind, Sku } from '../core/model';
import { LedgerStore } from '../core/store';
import { Icon } from '../ui/icon';
import { PriceHistory } from '../ui/price-history';
import { Toast } from '../ui/toast';

type Tab = 'LIQUOR' | 'BEER' | 'ARCHIVED';
interface Card { brand: Brand; items: Sku[] }
type DeleteTarget = { ids: string[]; label: string };
type Target = { id: string } | { nameEn: string; nameTe: string; cat: Cat };

const sizeOrder = (z: string) => {
  const k = SIZES.indexOf(z);
  return k < 0 ? 99 : k;
};

/**
 * The catalogue as brand cards: Brand → type → size, each item with its prices.
 * Renames here reach every day's form. Items can be grouped under brands, archived or deleted.
 */
@Component({
  selector: 'app-catalog',
  imports: [Icon, PriceHistory, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen" [style.padding-bottom]="picking() ? '180px' : null">
      <header class="screen-head">
        <a class="btn icon quiet" routerLink="/stock" [attr.aria-label]="i.pick('Back to stock', 'స్టాక్‌కు తిరిగి')"><app-icon name="left" /></a>
        <div class="grow"><h1>{{ i.pick('Catalogue', 'కేటలాగ్') }}</h1><div class="sub">{{ store.brands().length }} {{ i.pick('brands', 'బ్రాండ్లు') }} · {{ store.skus().length }} {{ i.pick('items', 'ఐటమ్‌లు') }}</div></div>
        <button class="btn icon quiet" type="button" (click)="openAdd()" [attr.aria-label]="i.pick('Add item', 'ఐటమ్ జోడించు')"><app-icon name="plus" /></button>
        <div style="position: relative">
          <button class="btn icon quiet" type="button" (click)="menu.set(!menu())" aria-haspopup="menu" [attr.aria-expanded]="menu()" [attr.aria-label]="i.pick('More options', 'మరిన్ని ఎంపికలు')"><app-icon name="more" /></button>
          @if (menu()) {
            <div style="position: fixed; inset: 0; z-index: 30" (click)="menu.set(false)"></div>
            <div role="menu" class="menu">
              <button role="menuitem" type="button" (click)="menu.set(false); startPicking()" [disabled]="tab() === 'ARCHIVED'"><app-icon name="list" [size]="18" /><span>{{ i.pick('Group items under a brand', 'ఐటమ్‌లను బ్రాండ్ కింద చేర్చు') }}</span></button>
              <a role="menuitem" routerLink="/prices" class="menu-link"><app-icon name="note" [size]="18" /><span>{{ i.pick('Price list from a date', 'తేదీ నుంచి ధరల జాబితా') }}</span></a>
            </div>
          }
        </div>
      </header>

      <div class="seg" role="tablist" aria-label="Category">
        <button type="button" role="tab" [class.on]="tab() === 'LIQUOR'" (click)="setTab('LIQUOR')">{{ i.t('liquor') }}</button>
        <button type="button" role="tab" [class.on]="tab() === 'BEER'" (click)="setTab('BEER')">{{ i.t('beer') }}</button>
        <button type="button" role="tab" [class.on]="tab() === 'ARCHIVED'" (click)="setTab('ARCHIVED')">{{ i.pick('Archived', 'ఆర్కైవ్') }} ({{ archivedCount() }})</button>
      </div>

      <input class="input" [placeholder]="i.pick('Search brand, type or size', 'బ్రాండ్, రకం, సైజు వెతకండి')" [value]="q()" (input)="q.set($any($event.target).value)" />

      @if (picking()) {
        <div class="al warn"><app-icon name="info" /><span>{{ i.pick('Tap items to select them, then group them under one brand.', 'ఐటమ్‌లను ఎంచుకుని ఒక బ్రాండ్ కింద చేర్చండి.') }}</span></div>
      }

      @for (c of cards(); track c.brand.id) {
        <section class="card tight">
          @if (editBrand()?.id === c.brand.id) {
            <form style="display: flex; flex-direction: column; gap: 8px" (submit)="$event.preventDefault(); saveBrand()">
              <div class="row-between"><span class="cap">{{ i.pick('Brand', 'బ్రాండ్') }}</span>
                <div style="position: relative">
                  <button class="btn icon quiet" type="button" (click)="itemMenu.set(itemMenu() === 'b' + c.brand.id ? null : 'b' + c.brand.id)" [attr.aria-label]="i.pick('Brand options', 'బ్రాండ్ ఎంపికలు')"><app-icon name="more" /></button>
                  @if (itemMenu() === 'b' + c.brand.id) {
                    <div style="position: fixed; inset: 0; z-index: 30" (click)="itemMenu.set(null)"></div>
                    <div role="menu" class="menu">
                      @if (tab() === 'ARCHIVED') {
                        <button role="menuitem" type="button" (click)="itemMenu.set(null); unarchive(ids(c))"><app-icon name="upload" [size]="18" /><span>{{ i.pick('Move all back to catalogue', 'అన్నీ కేటలాగ్‌కు తిరిగి') }}</span></button>
                      } @else {
                        <button role="menuitem" type="button" (click)="itemMenu.set(null); archive(ids(c), i.name(c.brand))"><app-icon name="download" [size]="18" /><span>{{ i.pick('Archive the whole brand', 'మొత్తం బ్రాండ్ ఆర్కైవ్') }}</span></button>
                      }
                      <button role="menuitem" type="button" class="danger" (click)="itemMenu.set(null); askDelete(ids(c), c.brand.nameEn)"><app-icon name="trash" [size]="18" /><span>{{ i.pick('Delete the whole brand', 'మొత్తం బ్రాండ్ తొలగించు') }}</span></button>
                    </div>
                  }
                </div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
                <input class="input" [value]="editBrand()!.nameEn" (input)="patchBrand({ nameEn: $any($event.target).value })" [attr.aria-label]="i.t('nameEn')" [placeholder]="i.t('nameEn')" />
                <input class="input" [value]="editBrand()!.nameTe" (input)="patchBrand({ nameTe: $any($event.target).value })" [attr.aria-label]="i.t('nameTe')" [placeholder]="i.t('nameTe')" />
                <label class="field"><span class="cap">{{ i.pick('Liquor or beer', 'లిక్కర్ / బీర్') }}</span>
                  <select class="input" (change)="patchBrand({ cat: $any($event.target).value })">
                    <option value="LIQUOR" [selected]="editBrand()!.cat === 'LIQUOR'">{{ i.t('liquor') }}</option>
                    <option value="BEER" [selected]="editBrand()!.cat === 'BEER'">{{ i.t('beer') }}</option>
                  </select>
                </label>
                <label class="field"><span class="cap">{{ i.pick('Kind', 'రకం') }}{{ c.items.length > 1 ? i.pick(' (all items)', ' (అన్నీ)') : '' }}</span>
                  <select class="input" (change)="brandKind.set($any($event.target).value)">
                    @if (!brandKind()) { <option value="" selected>{{ i.pick('Mixed: set per item', 'వేర్వేరు') }}</option> }
                    @for (k of kinds; track k.v) { <option [value]="k.v" [selected]="k.v === brandKind()">{{ i.pick(k.en, k.te) }}</option> }
                  </select>
                </label>
              </div>
              <div class="cap">{{ i.pick('The new name shows on every day’s form, past days too.', 'కొత్త పేరు అన్ని రోజుల ఫారమ్‌లలో కనిపిస్తుంది.') }}</div>
              <div class="row">
                <button class="btn grow" type="button" (click)="editBrand.set(null)">{{ i.t('cancel') }}</button>
                <button class="btn primary grow" type="submit" [disabled]="!editBrand()!.nameEn.trim() || busy()">{{ i.pick('Save', 'సేవ్') }}</button>
              </div>
            </form>
          } @else {
            <button type="button" class="row" style="border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; color: inherit; width: 100%" (click)="startBrand(c)" [disabled]="picking()">
              <span class="grow" style="display: flex; flex-direction: column">
                <span class="title" style="font-size: 18px">{{ i.name(c.brand) }}</span>
                <span class="cap">{{ kindsOf(c) }} · {{ c.items.length }} {{ c.items.length === 1 ? i.pick('item', 'ఐటమ్') : i.pick('items', 'ఐటమ్‌లు') }}</span>
              </span>
              @if (!picking()) { <app-icon name="settings" [size]="18" /> }
            </button>
          }

          @for (s of c.items; track s.id) {
            <div style="border-top: 1px solid var(--rule)">
              <button type="button" class="row" style="width: 100%; min-height: 48px; border: 0; background: transparent; padding: 4px 0; text-align: left; cursor: pointer; color: inherit" [attr.aria-expanded]="open() === s.id" (click)="tapItem(s)">
                @if (picking()) { <input type="checkbox" tabindex="-1" [checked]="picked().has(s.id)" style="width: 22px; height: 22px; accent-color: var(--wine); pointer-events: none" /> }
                <span class="chip" style="min-width: 44px; justify-content: center">{{ s.size }}</span>
                <span class="grow small"><b>{{ typeLabel(s) }}</b></span>
                <span class="num small" style="min-width: 96px; text-align: right">₹{{ group(store.priceToday(s).rate) }} / ₹{{ group(round(store.priceToday(s).cost)) }}</span>
              </button>
              @if (open() === s.id && editItem(); as e) {
                <form style="display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px" (submit)="$event.preventDefault(); saveItem()">
                  <div class="row-between"><span class="cap">{{ i.pick('Item', 'ఐటమ్') }} · {{ s.nameEn }} {{ s.size }}</span>
                    <div style="position: relative">
                      <button class="btn icon quiet" type="button" (click)="itemMenu.set(itemMenu() === s.id ? null : s.id)" [attr.aria-label]="i.pick('Item options', 'ఐటమ్ ఎంపికలు')"><app-icon name="more" /></button>
                      @if (itemMenu() === s.id) {
                        <div style="position: fixed; inset: 0; z-index: 30" (click)="itemMenu.set(null)"></div>
                        <div role="menu" class="menu">
                          <button role="menuitem" type="button" (click)="itemMenu.set(null); openGroup([s.id])"><app-icon name="right" [size]="18" /><span>{{ i.pick('Move to another brand', 'వేరే బ్రాండ్‌కు మార్చు') }}</span></button>
                          @if (s.active) {
                            <button role="menuitem" type="button" (click)="itemMenu.set(null); archive([s.id], s.nameEn + ' ' + s.size)"><app-icon name="download" [size]="18" /><span>{{ i.pick('Archive', 'ఆర్కైవ్') }}</span></button>
                          } @else {
                            <button role="menuitem" type="button" (click)="itemMenu.set(null); unarchive([s.id])"><app-icon name="upload" [size]="18" /><span>{{ i.pick('Move back to catalogue', 'కేటలాగ్‌కు తిరిగి') }}</span></button>
                          }
                          <button role="menuitem" type="button" class="danger" (click)="itemMenu.set(null); askDelete([s.id], s.nameEn + ' ' + s.size)"><app-icon name="trash" [size]="18" /><span>{{ i.pick('Delete', 'తొలగించు') }}</span></button>
                        </div>
                      }
                    </div>
                  </div>
                  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
                    <label class="field"><span class="cap">{{ i.pick('Type (English)', 'రకం (ఇంగ్లీష్)') }}</span><input class="input" [value]="e.typeEn" [placeholder]="i.pick('e.g. Strong', 'ఉదా. Strong')" (input)="patchItem({ typeEn: $any($event.target).value })" /></label>
                    <label class="field"><span class="cap">{{ i.pick('Type (Telugu)', 'రకం (తెలుగు)') }}</span><input class="input" [value]="e.typeTe" (input)="patchItem({ typeTe: $any($event.target).value })" /></label>
                    <label class="field"><span class="cap">{{ i.t('size') }}</span>
                      <select class="input" (change)="patchItem({ size: $any($event.target).value })">@for (z of sizesFor(s.size); track z) { <option [value]="z" [selected]="z === e.size">{{ z }}</option> }</select>
                    </label>
                    <label class="field"><span class="cap">{{ i.pick('Kind', 'రకం') }}</span>
                      <select class="input" (change)="patchItem({ kind: $any($event.target).value })">@for (k of kinds; track k.v) { <option [value]="k.v" [selected]="k.v === e.kind">{{ i.pick(k.en, k.te) }}</option> }</select>
                    </label>
                  </div>
                  <div class="cap">{{ i.pick('Name on forms:', 'ఫారమ్‌లో పేరు:') }} <b>{{ preview(c.brand, e) }}</b></div>
                  <div class="row">
                    <button class="btn grow" type="button" (click)="open.set(null)">{{ i.t('cancel') }}</button>
                    <button class="btn primary grow" type="submit" [disabled]="busy()">{{ i.pick('Save', 'సేవ్') }}</button>
                  </div>
                  <app-price-history [sku]="s" />
                </form>
              }
            </div>
          }
        </section>
      } @empty {
        <div class="cap" style="text-align: center; padding: 24px">{{ tab() === 'ARCHIVED' ? i.pick('Nothing archived.', 'ఆర్కైవ్‌లో ఏమీ లేదు.') : '—' }}</div>
      }
    </main>

    @if (picking()) {
      <div class="fab-bar" style="display: flex; gap: 8px">
        <button class="btn" type="button" style="flex: 1; width: auto; background: var(--surface)" (click)="stopPicking()">{{ i.t('cancel') }}</button>
        <button class="btn primary" type="button" style="flex: 2; width: auto" [disabled]="!picked().size" (click)="openGroup([...picked()])">{{ i.pick('Group ' + picked().size + ' under a brand', picked().size + ' ను బ్రాండ్ కింద చేర్చు') }}</button>
      </div>
    }

    @if (grouping(); as g) {
      <div class="sheet-backdrop" (click)="grouping.set(null)">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="groupTitle" (click)="$event.stopPropagation()">
          <div class="handle"></div>
          <h2 id="groupTitle" class="title" style="font-size: 22px; line-height: 34px">{{ g.ids.length === 1 ? i.pick('Move to brand', 'బ్రాండ్‌కు మార్చు') : i.pick('Group ' + g.ids.length + ' items under', g.ids.length + ' ఐటమ్‌లను చేర్చు') }}</h2>
          <div class="small muted">{{ groupNames(g.ids) }}</div>
          <div class="seg">
            <button type="button" [class.on]="g.mode === 'new'" (click)="patchGroup({ mode: 'new' })">{{ i.pick('New brand', 'కొత్త బ్రాండ్') }}</button>
            <button type="button" [class.on]="g.mode === 'existing'" (click)="patchGroup({ mode: 'existing' })">{{ i.pick('Existing brand', 'ఉన్న బ్రాండ్') }}</button>
          </div>
          @if (g.mode === 'new') {
            <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
              <input class="input" [placeholder]="i.pick('Brand name, e.g. Kingfisher', 'బ్రాండ్ పేరు')" [value]="g.nameEn" (input)="patchGroup({ nameEn: $any($event.target).value })" [attr.aria-label]="i.t('nameEn')" />
              <input class="input" [placeholder]="i.t('nameTe')" [value]="g.nameTe" (input)="patchGroup({ nameTe: $any($event.target).value })" [attr.aria-label]="i.t('nameTe')" />
            </div>
          } @else {
            <input class="input" [placeholder]="i.pick('Search brands', 'బ్రాండ్లు వెతకండి')" [value]="g.q" (input)="patchGroup({ q: $any($event.target).value })" />
            <div style="display: flex; flex-direction: column; max-height: 40vh; overflow-y: auto">
              @for (b of brandChoices(); track b.id) {
                <button type="button" class="opt" [class.on]="g.brandId === b.id" (click)="patchGroup({ brandId: b.id })" style="margin-bottom: 6px">
                  <span class="label">{{ i.name(b) }}</span>
                </button>
              }
            </div>
          }
          <div class="cap">{{ i.pick('Each item keeps its old name as its type, e.g. “K.F. Strong”. Shorten it afterwards to “Strong”.', 'ప్రతి ఐటమ్ పాత పేరు రకంగా ఉంటుంది. తర్వాత చిన్నగా మార్చండి.') }}</div>
          <div class="row">
            <button class="btn grow" type="button" style="min-height: 56px" (click)="grouping.set(null)">{{ i.t('cancel') }}</button>
            <button class="btn primary" type="button" style="flex: 2" [disabled]="!groupReady() || busy()" (click)="doGroup()">{{ i.pick('Group', 'చేర్చు') }}</button>
          </div>
        </section>
      </div>
    }

    @if (archiving(); as a) {
      <div class="sheet-backdrop" (click)="archiving.set(null)">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="archTitle" (click)="$event.stopPropagation()">
          <div class="handle"></div>
          <h2 id="archTitle" class="title" style="font-size: 22px; line-height: 34px">{{ i.pick('Archive ' + a.label + '?', a.label + ' ఆర్కైవ్ చేయాలా?') }}</h2>
          <ul class="small" style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px">
            <li>{{ i.pick('Left off new day forms, deliveries and lists. Past days, sales and stock stay as they are.', 'కొత్త ఫారమ్‌లలో ఉండదు. పాత రోజులు అలాగే ఉంటాయి.') }}</li>
            <li><b>{{ i.pick(group(a.stock) + ' bottles are still in stock.', group(a.stock) + ' బాటిళ్లు ఇంకా స్టాక్‌లో ఉన్నాయి.') }}</b> {{ i.pick('It stays on the day form until that stock is 0.', 'స్టాక్ 0 అయ్యే వరకు ఫారమ్‌లో ఉంటుంది.') }}</li>
            <li>{{ i.pick('You can move it back from the Archived tab.', 'ఆర్కైవ్ ట్యాబ్ నుంచి తిరిగి తేవచ్చు.') }}</li>
          </ul>
          <div class="row">
            <button class="btn grow" type="button" style="min-height: 56px" (click)="archiving.set(null)">{{ i.t('cancel') }}</button>
            <button class="btn primary" type="button" style="flex: 2" [disabled]="busy()" (click)="doArchive(a.ids, a.label)">{{ i.pick('Archive', 'ఆర్కైవ్') }}</button>
          </div>
        </section>
      </div>
    }

    @if (deleting(); as d) {
      <div class="sheet-backdrop" (click)="deleting.set(null)">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="delTitle" (click)="$event.stopPropagation()">
          <div class="handle"></div>
          <h2 id="delTitle" class="title" style="font-size: 22px; line-height: 34px">{{ i.pick('Delete ' + d.label + '?', d.label + ' తొలగించాలా?') }}</h2>
          @if (delUsage(); as u) {
            @if (u.days || u.deliveries) {
              <div class="al critical"><app-icon name="alert" /><span>
                {{ i.pick('Used on ' + u.days + (u.days === 1 ? ' day' : ' days') + ' and in ' + u.deliveries + (u.deliveries === 1 ? ' delivery' : ' deliveries') + '. Deleting removes it from all of them, so past sales, cash expected and P&L change.', u.days + ' రోజులు, ' + u.deliveries + ' సరుకుల నుంచి తొలగిస్తారు. పాత అమ్మకాలు, లాభం మారతాయి.') }}
              </span></div>
              <div class="small">{{ i.pick('To keep the records, archive it instead.', 'రికార్డులు ఉంచాలంటే ఆర్కైవ్ చేయండి.') }}</div>
              @if (d.ids.length && isActive(d.ids)) {
                <button class="btn primary" type="button" (click)="deleting.set(null); archive(d.ids, d.label)">{{ i.pick('Archive instead', 'బదులుగా ఆర్కైవ్') }}</button>
              }
            } @else {
              <div class="small">{{ i.pick('Not used on any day or delivery.', 'ఏ రోజులోనూ వాడలేదు.') }}</div>
            }
          }
          <label class="field"><span class="cap">{{ i.pick('Type ' + d.label + ' to delete', 'తొలగించడానికి ' + d.label + ' అని టైప్ చేయండి') }}</span>
            <input class="input" [value]="delTyped()" (input)="delTyped.set($any($event.target).value)" autocomplete="off" />
          </label>
          <div class="cap">{{ i.pick('A safety copy is kept: Settings → Undo brings it back.', 'కాపీ ఉంచబడుతుంది: సెట్టింగ్స్‌లో రద్దు చేయవచ్చు.') }}</div>
          <div class="row">
            <button class="btn grow" type="button" style="min-height: 56px" (click)="deleting.set(null)">{{ i.t('cancel') }}</button>
            <button class="btn danger" type="button" style="flex: 2" [disabled]="!delOk() || busy()" (click)="doDelete()">{{ i.pick('Delete everywhere', 'అన్నిచోట్లా తొలగించు') }}</button>
          </div>
        </section>
      </div>
    }

    @if (adding(); as n) {
      <div class="sheet-backdrop" (click)="adding.set(null)">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="addTitle" (click)="$event.stopPropagation()">
          <div class="handle"></div>
          <h2 id="addTitle" class="title" style="font-size: 22px; line-height: 34px">{{ i.pick('Add item', 'ఐటమ్ జోడించు') }}</h2>
          <label class="field"><span class="cap">{{ i.pick('Brand', 'బ్రాండ్') }}</span>
            <select class="input" (change)="patchAdd({ brandId: $any($event.target).value })">
              <option value="" [selected]="!n.brandId">{{ i.pick('New brand…', 'కొత్త బ్రాండ్…') }}</option>
              @for (b of allBrands(); track b.id) { <option [value]="b.id" [selected]="n.brandId === b.id">{{ i.name(b) }}</option> }
            </select>
          </label>
          @if (!n.brandId) {
            <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
              <input class="input" [placeholder]="i.pick('Brand name', 'బ్రాండ్ పేరు')" [value]="n.nameEn" (input)="patchAdd({ nameEn: $any($event.target).value })" [attr.aria-label]="i.t('nameEn')" />
              <input class="input" [placeholder]="i.t('nameTe')" [value]="n.nameTe" (input)="patchAdd({ nameTe: $any($event.target).value })" [attr.aria-label]="i.t('nameTe')" />
              <select class="input" style="grid-column: 1 / -1" (change)="patchAdd({ cat: $any($event.target).value })" aria-label="Category">
                <option value="LIQUOR" [selected]="n.cat === 'LIQUOR'">{{ i.t('liquor') }}</option>
                <option value="BEER" [selected]="n.cat === 'BEER'">{{ i.t('beer') }}</option>
              </select>
            </div>
          }
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
            <input class="input" [placeholder]="i.pick('Type, e.g. Strong (optional)', 'రకం (ఐచ్ఛికం)')" [value]="n.typeEn" (input)="patchAdd({ typeEn: $any($event.target).value })" />
            <input class="input" [placeholder]="i.pick('Type (Telugu)', 'రకం (తెలుగు)')" [value]="n.typeTe" (input)="patchAdd({ typeTe: $any($event.target).value })" />
            <select class="input" (change)="patchAdd({ size: $any($event.target).value })" [attr.aria-label]="i.t('size')">@for (z of sizes; track z) { <option [value]="z" [selected]="z === n.size">{{ z }}</option> }</select>
            <select class="input" (change)="patchAdd({ kind: $any($event.target).value })" aria-label="Kind">@for (k of kinds; track k.v) { <option [value]="k.v" [selected]="k.v === n.kind">{{ i.pick(k.en, k.te) }}</option> }</select>
            <input class="input n" inputmode="numeric" [placeholder]="i.t('sellRate')" [value]="n.rate || ''" (input)="patchAdd({ rate: parseCount($any($event.target).value) })" [attr.aria-label]="i.t('sellRate')" />
            <input class="input n" inputmode="numeric" [placeholder]="i.t('buyCost')" [value]="n.cost || ''" (input)="patchAdd({ cost: parseCount($any($event.target).value) })" [attr.aria-label]="i.t('buyCost')" />
          </div>
          <div class="row">
            <button class="btn grow" type="button" style="min-height: 56px" (click)="adding.set(null)">{{ i.t('cancel') }}</button>
            <button class="btn primary" type="button" style="flex: 2" [disabled]="(!n.brandId && !n.nameEn.trim()) || busy()" (click)="doAdd()">{{ i.pick('Add', 'జోడించు') }}</button>
          </div>
        </section>
      </div>
    }
  `,
})
export class Catalog {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private toast = inject(Toast);
  protected group = group;
  protected round = Math.round;
  protected parseCount = parseCount;
  protected kinds = KINDS;
  protected sizes = SIZES;

  protected tab = signal<Tab>('LIQUOR');
  protected q = signal('');
  protected menu = signal(false);
  protected itemMenu = signal<string | null>(null);
  protected busy = signal(false);

  private brandMap = computed(() => new Map(this.store.brands().map((b) => [b.id, b])));
  protected allBrands = computed(() => [...this.store.brands()].sort((a, b) => a.nameEn.localeCompare(b.nameEn)));
  protected archivedCount = computed(() => this.store.skus().filter((s) => !s.active).length);

  /** Brand cards for the tab, in the order of the paper sheet (by each brand's first item). */
  protected cards = computed<Card[]>(() => {
    const tab = this.tab();
    const q = this.q().trim().toLowerCase();
    const by = new Map<string, Sku[]>();
    for (const s of this.store.skus()) {
      if (tab === 'ARCHIVED' ? s.active : !s.active || s.cat !== tab) continue;
      if (q && !`${s.nameEn} ${s.nameTe} ${s.size} ${s.kind ?? ''}`.toLowerCase().includes(q)) continue;
      const k = s.brandId ?? s.id;
      by.set(k, [...(by.get(k) ?? []), s]);
    }
    const out: Card[] = [];
    for (const [id, items] of by) {
      const brand = this.brandMap().get(id) ?? { id, cat: items[0].cat, nameEn: items[0].nameEn, nameTe: items[0].nameTe };
      items.sort((a, b) => (a.typeEn ?? '').localeCompare(b.typeEn ?? '') || sizeOrder(a.size) - sizeOrder(b.size));
      out.push({ brand, items });
    }
    const first = (c: Card) => Math.min(...c.items.map((s) => (s.cat === 'LIQUOR' ? 0 : 1000) + s.sno));
    return out.sort((a, b) => first(a) - first(b));
  });

  protected ids = (c: Card) => c.items.map((s) => s.id);
  protected kindsOf(c: Card) {
    const ks = [...new Set(c.items.map((s) => s.kind ?? 'other'))];
    return ks.map((k) => { const x = KINDS.find((y) => y.v === k)!; return this.i.pick(x.en, x.te); }).join(', ');
  }
  protected typeLabel(s: Sku) {
    const t = this.i.isTe() ? s.typeTe || s.typeEn : s.typeEn;
    return t;
  }
  protected sizesFor(current: string) {
    return SIZES.includes(current) ? SIZES : [current, ...SIZES];
  }

  protected setTab(t: Tab) {
    this.tab.set(t);
    this.open.set(null);
    this.editBrand.set(null);
    this.stopPicking();
  }

  // ---------- brand edit ----------

  protected editBrand = signal<Brand | null>(null);
  /** The kind for all the brand's items; '' when they differ and nothing was picked. */
  protected brandKind = signal<Kind | ''>('');
  private kindAtStart: Kind | '' = '';
  protected startBrand(c: Card) {
    this.open.set(null);
    this.editBrand.set({ ...c.brand });
    const ks = new Set(c.items.map((s) => s.kind ?? 'other'));
    this.kindAtStart = ks.size === 1 ? [...ks][0] : '';
    this.brandKind.set(this.kindAtStart);
  }
  protected patchBrand(p: Partial<Brand>) {
    this.editBrand.update((b) => (b ? { ...b, ...p } : b));
  }
  protected async saveBrand() {
    const b = this.editBrand();
    if (!b) return;
    const kind = this.brandKind();
    await this.run(() => this.store.updateBrand(b.id, { nameEn: b.nameEn.trim(), nameTe: b.nameTe.trim() || b.nameEn.trim(), cat: b.cat }, kind && kind !== this.kindAtStart ? kind : undefined));
    this.editBrand.set(null);
    this.toast.show(this.i.pick(`Saved ${b.nameEn.trim()}`, `${b.nameTe.trim() || b.nameEn.trim()} సేవ్ అయింది`));
  }

  // ---------- item edit ----------

  protected open = signal<string | null>(null);
  protected editItem = signal<{ typeEn: string; typeTe: string; size: string; kind: Kind } | null>(null);
  protected tapItem(s: Sku) {
    if (this.picking()) {
      this.picked.update((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; });
      return;
    }
    this.editBrand.set(null);
    if (this.open() === s.id) { this.open.set(null); return; }
    this.open.set(s.id);
    this.editItem.set({ typeEn: s.typeEn ?? '', typeTe: s.typeTe ?? '', size: s.size, kind: s.kind ?? 'other' });
  }
  protected patchItem(p: Partial<{ typeEn: string; typeTe: string; size: string; kind: Kind }>) {
    this.editItem.update((e) => (e ? { ...e, ...p } : e));
  }
  protected preview(b: Brand, e: { typeEn: string; size: string }) {
    return [b.nameEn, e.typeEn.trim()].filter(Boolean).join(' ') + ' · ' + e.size;
  }
  protected async saveItem() {
    const id = this.open();
    const e = this.editItem();
    if (!id || !e) return;
    await this.run(() => this.store.updateItem(id, { typeEn: e.typeEn.trim(), typeTe: e.typeTe.trim() || e.typeEn.trim(), size: e.size, kind: e.kind }));
    this.open.set(null);
    this.toast.show(this.i.pick('Saved', 'సేవ్ అయింది'));
  }

  // ---------- grouping ----------

  protected picking = signal(false);
  protected picked = signal(new Set<string>());
  protected startPicking() {
    this.open.set(null);
    this.editBrand.set(null);
    this.picked.set(new Set());
    this.picking.set(true);
  }
  protected stopPicking() {
    this.picking.set(false);
    this.picked.set(new Set());
  }

  protected grouping = signal<{ ids: string[]; mode: 'new' | 'existing'; nameEn: string; nameTe: string; brandId: string; q: string } | null>(null);
  protected openGroup(ids: string[]) {
    this.grouping.set({ ids, mode: ids.length > 1 ? 'new' : 'existing', nameEn: '', nameTe: '', brandId: '', q: '' });
  }
  protected patchGroup(p: Partial<NonNullable<ReturnType<typeof this.grouping>>>) {
    this.grouping.update((g) => (g ? { ...g, ...p } : g));
  }
  protected groupNames(ids: string[]) {
    const m = this.store.skuMap();
    return ids.map((id) => m.get(id)).filter(Boolean).map((s) => `${s!.nameEn} ${s!.size}`).join(', ');
  }
  protected brandChoices = computed(() => {
    const g = this.grouping();
    if (!g) return [];
    const q = g.q.trim().toLowerCase();
    const own = new Set(g.ids.map((id) => this.store.skuMap().get(id)?.brandId));
    const cat = this.store.skuMap().get(g.ids[0])?.cat;
    return this.allBrands()
      .filter((b) => !(g.ids.length === 1 && own.has(b.id)))
      .filter((b) => !q || `${b.nameEn} ${b.nameTe}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.cat === cat) - Number(a.cat === cat));
  });
  protected groupReady = computed(() => {
    const g = this.grouping();
    return !!g && (g.mode === 'new' ? !!g.nameEn.trim() : !!g.brandId);
  });
  protected async doGroup() {
    const g = this.grouping();
    if (!g || !this.groupReady()) return;
    const cat = this.store.skuMap().get(g.ids[0])?.cat ?? 'LIQUOR';
    const target: Target = g.mode === 'new' ? { nameEn: g.nameEn, nameTe: g.nameTe, cat } : { id: g.brandId };
    await this.run(() => this.store.moveToBrand(g.ids, target));
    this.grouping.set(null);
    this.stopPicking();
    this.open.set(null);
    this.toast.show(this.i.pick('Grouped. Tap each item to shorten its type.', 'చేర్చారు. ప్రతి ఐటమ్ రకం చిన్నగా మార్చండి.'), 4000);
  }

  // ---------- archive ----------

  protected archiving = signal<{ ids: string[]; label: string; stock: number } | null>(null);
  private stockOf(ids: string[]) {
    const last = this.store.lastSaved();
    const bal = last ? this.store.balances()[last] ?? {} : {};
    return ids.reduce((a, id) => a + (bal[id] ?? 0), 0);
  }
  protected archive(ids: string[], label: string) {
    const stock = this.stockOf(ids);
    if (stock > 0) this.archiving.set({ ids, label, stock });
    else this.doArchive(ids, label);
  }
  protected async doArchive(ids: string[], label: string) {
    await this.run(() => this.store.setArchived(ids, true));
    this.archiving.set(null);
    this.open.set(null);
    this.editBrand.set(null);
    this.toast.show(this.i.pick(`${label} archived`, `${label} ఆర్కైవ్ అయింది`));
  }
  protected async unarchive(ids: string[]) {
    await this.run(() => this.store.setArchived(ids, false));
    this.open.set(null);
    this.editBrand.set(null);
    this.toast.show(this.i.pick('Moved back to catalogue', 'కేటలాగ్‌కు తిరిగి వచ్చింది'));
  }
  protected isActive(ids: string[]) {
    const m = this.store.skuMap();
    return ids.some((id) => m.get(id)?.active);
  }

  // ---------- delete ----------

  protected deleting = signal<DeleteTarget | null>(null);
  protected delTyped = signal('');
  protected delUsage = computed(() => {
    const d = this.deleting();
    return d ? this.store.usage(d.ids) : null;
  });
  protected delOk = computed(() => {
    const d = this.deleting();
    const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
    return !!d && norm(this.delTyped()) === norm(d.label);
  });
  protected askDelete(ids: string[], label: string) {
    this.delTyped.set('');
    this.deleting.set({ ids, label });
  }
  protected async doDelete() {
    const d = this.deleting();
    if (!d || !this.delOk()) return;
    await this.run(() => this.store.deleteItems(d.ids));
    this.deleting.set(null);
    this.open.set(null);
    this.editBrand.set(null);
    this.toast.show(this.i.pick(`${d.label} deleted`, `${d.label} తొలగించారు`));
  }

  // ---------- add ----------

  protected adding = signal<{ brandId: string; nameEn: string; nameTe: string; cat: Cat; typeEn: string; typeTe: string; size: string; kind: Kind; rate: number; cost: number } | null>(null);
  protected openAdd() {
    const cat: Cat = this.tab() === 'BEER' ? 'BEER' : 'LIQUOR';
    this.adding.set({ brandId: '', nameEn: '', nameTe: '', cat, typeEn: '', typeTe: '', size: cat === 'BEER' ? 'Q' : 'N', kind: cat === 'BEER' ? 'beer' : 'whisky', rate: 0, cost: 0 });
  }
  protected patchAdd(p: Partial<NonNullable<ReturnType<typeof this.adding>>>) {
    this.adding.update((n) => (n ? { ...n, ...p } : n));
  }
  protected async doAdd() {
    const n = this.adding();
    if (!n) return;
    const brand: Target = n.brandId ? { id: n.brandId } : { nameEn: n.nameEn, nameTe: n.nameTe, cat: n.cat };
    const sku = await this.run(() => this.store.addItem(brand, { typeEn: n.typeEn, typeTe: n.typeTe, size: n.size, kind: n.kind, rate: n.rate, cost: n.cost }));
    this.adding.set(null);
    if (sku) {
      this.tab.set(sku.cat);
      this.toast.show(this.i.pick(`Added ${sku.nameEn} ${sku.size}`, `${sku.nameTe} ${sku.size} జోడించారు`));
    }
  }

  private async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await fn();
    } catch (e) {
      this.toast.show(String((e as Error).message ?? e));
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }
}
