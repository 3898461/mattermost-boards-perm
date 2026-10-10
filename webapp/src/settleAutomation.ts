// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board, IPropertyTemplate, IPropertyOption} from './blocks/board'
import {Card} from './blocks/card'
import {getBoard} from './store/boards'
import store from './store'
import {sendFlashMessage} from './components/flashMessages'

// Settlement automation for the 1ALL project board.
//
// Conventions (documented in boards-settlement-design.md; renaming a
// property below disables the corresponding automation):
// - "实际单价": select property, each option label ends with digits
//   ("客户A图标1000" -> 1000). The "remote control" for pricing.
// - "人天": number property.
// - "单价" / "实际金额": number properties, auto-written, read-only.
// - "制作状态" / "结算状态": select properties driving date stamps.
// - "完成日期" / "申请日期" / "结算日期" / "付款日期": date properties.
//
// All automation runs after a property change settles, through
// mutator.changePropertyValue, so it covers the card dialog, table cells
// and kanban drags alike.

export const SETTLE_PROP_NAMES = {
    unitPriceSelect: '实际单价',
    personDays: '人天',
    unitPrice: '单价',
    amount: '实际金额',
    makeStatus: '制作状态',
    settleStatus: '结算状态',
    client: '甲方',
    dateDone: '完成日期',
    dateApply: '申请日期',
    dateSettle: '结算日期',
    datePaid: '付款日期',
}

// Properties that are auto-managed: UI editing is disabled (see
// PropertyValueElement) and every save overwrites them with computed values,
// so a manual edit never sticks.
const AUTO_MANAGED = new Set<string>([
    SETTLE_PROP_NAMES.unitPrice,
    SETTLE_PROP_NAMES.amount,
    '总完成度',
])

export function isAutoManagedProperty(name: string | undefined): boolean {
    return Boolean(name) && AUTO_MANAGED.has(name as string)
}

// Statuses whose cards keep their amount when the unit price changes.
const LOCKED_STATUSES = new Set<string>(['待付款', '已付款'])

// status option label -> date property name (first entry wins, never overwritten)
const STATUS_DATE_MAP: Array<{statusProp: string, optionLabel: string, dateProp: string}> = [
    {statusProp: SETTLE_PROP_NAMES.makeStatus, optionLabel: '制作完成', dateProp: SETTLE_PROP_NAMES.dateDone},
    {statusProp: SETTLE_PROP_NAMES.settleStatus, optionLabel: '申请结算', dateProp: SETTLE_PROP_NAMES.dateApply},
    {statusProp: SETTLE_PROP_NAMES.settleStatus, optionLabel: '待付款', dateProp: SETTLE_PROP_NAMES.dateSettle},
    {statusProp: SETTLE_PROP_NAMES.settleStatus, optionLabel: '已付款', dateProp: SETTLE_PROP_NAMES.datePaid},
]

export function findTemplateByName(board: Board, name: string): IPropertyTemplate | undefined {
    return board.cardProperties.find((t) => t.name === name)
}

// "客户A图标1000" -> 1000 ; "客户B界面950" -> 950 ; supports decimals.
export function parseTrailingNumber(label: string): number | undefined {
    const m = /(\d+(?:\.\d+)?)\s*$/.exec(label)
    return m ? parseFloat(m[1]) : undefined
}

function optionById(template: IPropertyTemplate, optionId: string): IPropertyOption | undefined {
    return template.options.find((o) => o.id === optionId)
}

function stringProp(card: Card, template: IPropertyTemplate): string | undefined {
    const v = card.fields.properties[template.id]
    if (v === undefined || v === null || Array.isArray(v)) {
        return undefined
    }
    return String(v)
}

function startOfToday(): string {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return String(d.getTime())
}

function flash(content: string, severity: 'normal' | 'high' = 'normal'): void {
    try {
        sendFlashMessage({content, severity})
    } catch {
        // Non-fatal: automation must never break a save.
    }
}

let inAutomation = false

type SetProperty = (propertyId: string, value?: string) => Promise<void>

export async function afterPropertyChange(args: {
    boardId: string
    card: Card
    changedPropertyId: string
    setProperty: SetProperty
}): Promise<void> {
    if (inAutomation) {
        return
    }
    const board = getBoard(args.boardId)(store.getState())
    if (!board) {
        return
    }
    inAutomation = true
    try {
        await applyAmountAutomation(board, args.card, args.changedPropertyId, args.setProperty)
        await applyDateStamps(board, args.card, args.changedPropertyId, args.setProperty)
    } finally {
        inAutomation = false
    }
}

async function applyAmountAutomation(board: Board, card: Card, changedPropertyId: string, setProperty: SetProperty): Promise<void> {
    const tSelect = findTemplateByName(board, SETTLE_PROP_NAMES.unitPriceSelect)
    const tDays = findTemplateByName(board, SETTLE_PROP_NAMES.personDays)
    const tPrice = findTemplateByName(board, SETTLE_PROP_NAMES.unitPrice)
    const tAmount = findTemplateByName(board, SETTLE_PROP_NAMES.amount)
    if (!tSelect || !tDays || !tPrice || !tAmount) {
        return
    }
    if (changedPropertyId !== tSelect.id && changedPropertyId !== tDays.id) {
        return
    }

    // Parse the unit price from the selected option label.
    const selectOptionId = stringProp(card, tSelect)
    const selectLabel = selectOptionId ? optionById(tSelect, selectOptionId)?.value : undefined
    const price = selectLabel ? parseTrailingNumber(selectLabel) : undefined
    if (price === undefined) {
        flash('实际单价选项格式不对（选项名末尾需要是数字），已保留原金额，请联系管理员', 'high')
        return
    }

    // 甲方 consistency: soft warning only, amount still follows the select.
    const tClient = findTemplateByName(board, SETTLE_PROP_NAMES.client)
    if (tClient && selectLabel) {
        const clientOptionId = stringProp(card, tClient)
        const clientLabel = clientOptionId ? optionById(tClient, clientOptionId)?.value : undefined
        if (clientLabel && !selectLabel.startsWith(clientLabel)) {
            flash(`实际单价“${selectLabel}”与甲方“${clientLabel}”不一致，请检查`, 'normal')
        }
    }

    // Lock rule: a price change on a settling/settled card is ignored.
    if (changedPropertyId === tSelect.id) {
        const tSettle = findTemplateByName(board, SETTLE_PROP_NAMES.settleStatus)
        if (tSettle) {
            const statusLabel = optionById(tSettle, stringProp(card, tSettle) || '')?.value
            if (statusLabel && LOCKED_STATUSES.has(statusLabel)) {
                return
            }
        }
    }

    const currentPrice = parseFloat(stringProp(card, tPrice) || '')
    if (!(currentPrice === price)) {
        await setProperty(tPrice.id, String(price))
    }

    const days = parseFloat(stringProp(card, tDays) || '')
    if (!isNaN(days)) {
        const amount = Math.round(days * price * 100) / 100
        const currentAmount = parseFloat(stringProp(card, tAmount) || '')
        if (!(currentAmount === amount)) {
            await setProperty(tAmount.id, String(amount))
        }
    }
}

async function applyDateStamps(board: Board, card: Card, changedPropertyId: string, setProperty: SetProperty): Promise<void> {
    for (const mapping of STATUS_DATE_MAP) {
        const tStatus = findTemplateByName(board, mapping.statusProp)
        if (!tStatus || tStatus.id !== changedPropertyId) {
            continue
        }
        const statusLabel = optionById(tStatus, stringProp(card, tStatus) || '')?.value
        if (statusLabel !== mapping.optionLabel) {
            continue
        }
        const tDate = findTemplateByName(board, mapping.dateProp)
        if (!tDate) {
            continue
        }
        // First entry wins: never overwrite an existing stamp.
        if (stringProp(card, tDate)) {
            continue
        }
        await setProperty(tDate.id, startOfToday())
    }
}
