// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Automatic colors for newly created select options.
//
// New options used to be created with propColorDefault (no color),
// forcing a manual recolor every time. Instead, derive the color from
// the option's "family": for price-style labels the family is the
// client （甲方） whose name prefixes the label （网易雷火图标900 and
// 网易雷火界面850 are both 网易）, so one client always lands on one
// color. If the family already has a color in this property (manual or
// automatic), reuse it; otherwise hash the family name into the
// palette, preferring colors no other family in the property uses.

import {Board, IPropertyOption, IPropertyTemplate} from '../blocks/board'
import {Constants} from '../constants'

const PALETTE = Object.keys(Constants.menuColors).filter((k) => k !== 'propColorDefault')
const CLIENT_PROPERTY_NAME = '甲方'
const DEFAULT_COLOR = 'propColorDefault'

// The family a label belongs to: the longest client （甲方 option) name
// that prefixes it, or the label with its trailing price digits
// stripped when no client matches.
export function optionFamilySeed(board: Board, value: string): string {
    const v = value.trim()
    const clientTemplate = board.cardProperties.find((p) => p.name === CLIENT_PROPERTY_NAME)
    if (clientTemplate) {
        let best = ''
        for (const o of clientTemplate.options) {
            const label = o.value.trim()
            if (label && v.startsWith(label) && label.length > best.length) {
                best = label
            }
        }
        if (best) {
            return best
        }
    }
    return v.replace(/[0-9０-９]+\s*$/, '').trim() || v
}

function hashSeed(seed: string): number {
    let h = 5381
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h + seed.charCodeAt(i)) | 0
    }
    return Math.abs(h)
}

export function pickOptionColor(board: Board, template: IPropertyTemplate, newValue: string): string {
    const seed = optionFamilySeed(board, newValue)
    const familyColors = new Map<string, string>()
    const usedByOthers = new Set<string>()
    for (const o of template.options) {
        if (!o.color || o.color === DEFAULT_COLOR) {
            continue
        }
        const otherSeed = optionFamilySeed(board, o.value)
        if (!familyColors.has(otherSeed)) {
            familyColors.set(otherSeed, o.color)
        }
        if (otherSeed !== seed) {
            usedByOthers.add(o.color)
        }
    }
    const existing = familyColors.get(seed)
    if (existing) {
        return existing
    }
    const start = hashSeed(seed) % PALETTE.length
    for (let step = 0; step < PALETTE.length; step++) {
        const candidate = PALETTE[(start + step) % PALETTE.length]
        if (!usedByOthers.has(candidate)) {
            return candidate
        }
    }
    return PALETTE[start]
}

// Display-order for option lists (plan A, 2026-10-22): group options by
// family so same-client labels sit together in the selector panel —
// families keep their first-appearance order from the stored list,
// labels sort alphabetically inside a family. Stored order is never
// modified; this only affects how the open panel presents options.
export function sortOptionsByFamily(board: Board, options: IPropertyOption[]): IPropertyOption[] {
    const familyRank = new Map<string, number>()
    for (const o of options) {
        const seed = optionFamilySeed(board, o.value)
        if (!familyRank.has(seed)) {
            familyRank.set(seed, familyRank.size)
        }
    }
    return [...options].sort((a, b) => {
        const ra = familyRank.get(optionFamilySeed(board, a.value)) ?? 0
        const rb = familyRank.get(optionFamilySeed(board, b.value)) ?? 0
        if (ra !== rb) {
            return ra - rb
        }
        return a.value.localeCompare(b.value, 'zh-CN')
    })
}
