// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {TestBlockFactory} from '../../test/testBlockFactory'
import {IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'

import {
    aggregatePersonFlow,
    aggregatePersonStats,
    aggregatePivot,
    DateRange,
} from './aggregation'

function makeTemplate(id: string, name: string, type: IPropertyTemplate['type'], options: Array<{id: string, value: string}> = []): IPropertyTemplate {
    return {
        id,
        name,
        type,
        options: options.map((o) => ({id: o.id, value: o.value, color: ''})),
    } as IPropertyTemplate
}

const IN_RANGE = new Date(2026, 5, 15, 12, 0, 0).getTime()
const OUT_RANGE = new Date(2025, 0, 15, 12, 0, 0).getTime()
const RANGE: DateRange = {
    start: new Date(2026, 5, 1).getTime(),
    end: new Date(2026, 5, 30, 23, 59, 59).getTime(),
}

function buildBoard() {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        makeTemplate('p-days', '人天', 'number'),
        makeTemplate('p-amount', '实际金额', 'number'),
        makeTemplate('p-status', '项目状态', 'select', [
            {id: 'o-draft', value: '草图'},
            {id: 'o-done', value: '完成'},
            {id: 'o-paid', value: '已付款'},
        ]),
        makeTemplate('p-done', '完成日期', 'date'),
        makeTemplate('p-detail', '完成度明细', 'text'),
        makeTemplate('p-price', '实际单价', 'select', [
            {id: 'o-p1000', value: '网易图标1000'},
        ]),
        makeTemplate('p-apply', '申请日期', 'date'),
        makeTemplate('p-settle', '结算日期', 'date'),
    ]
    return board
}

function makeCard(board: ReturnType<typeof buildBoard>, overrides: Partial<Card>): Card {
    const card = TestBlockFactory.createCard(board)
    return Object.assign(card, overrides)
}

describe('aggregatePersonFlow', () => {
    test('一张卡多人按占比拆行，分桶与标签正确', () => {
        const board = buildBoard()
        const card = makeCard(board, {
            title: '图标需求',
            createAt: IN_RANGE,
        })
        card.fields.properties['p-status'] = 'o-draft'
        card.fields.properties['p-days'] = '10'
        card.fields.properties['p-amount'] = '5000'
        card.fields.properties['p-detail'] = JSON.stringify({u1: 60, u2: 40})
        card.fields.properties['p-price'] = 'o-p1000'

        const flow = aggregatePersonFlow(board, [card], RANGE)
        expect(flow).toHaveLength(2)
        const r1 = flow.find((f) => f.userId === 'u1')!
        expect(r1.category).toBe('scheduled')
        expect(r1.statusLabel).toBe('草图')
        expect(r1.unitPriceLabel).toBe('网易图标1000')
        expect(r1.days).toBeCloseTo(6)
        expect(r1.amount).toBeCloseTo(3000)
        const r2 = flow.find((f) => f.userId === 'u2')!
        expect(r2.amount).toBeCloseTo(2000)
    })

    test('已付款走完成日期分桶；日期不在范围的卡不入流水', () => {
        const board = buildBoard()
        const paid = makeCard(board, {title: '已结卡'})
        paid.fields.properties['p-status'] = 'o-paid'
        paid.fields.properties['p-amount'] = '9000'
        paid.fields.properties['p-detail'] = JSON.stringify({u1: 100})
        paid.fields.properties['p-done'] = JSON.stringify({from: IN_RANGE})

        const stale = makeCard(board, {title: '过期卡'})
        stale.fields.properties['p-status'] = 'o-done'
        stale.fields.properties['p-amount'] = '7000'
        stale.fields.properties['p-detail'] = JSON.stringify({u1: 100})
        stale.fields.properties['p-done'] = JSON.stringify({from: OUT_RANGE})

        const flow = aggregatePersonFlow(board, [paid, stale], RANGE)
        expect(flow).toHaveLength(1)
        expect(flow[0].cardTitle).toBe('已结卡')
        expect(flow[0].category).toBe('settled')
    })

    test('流水金额合计与人员汇总口径一致', () => {
        const board = buildBoard()
        const a = makeCard(board, {title: 'A', createAt: IN_RANGE})
        a.fields.properties['p-status'] = 'o-draft'
        a.fields.properties['p-days'] = '10'
        a.fields.properties['p-amount'] = '5000'
        a.fields.properties['p-detail'] = JSON.stringify({u1: 60, u2: 40})
        const b = makeCard(board, {title: 'B'})
        b.fields.properties['p-status'] = 'o-paid'
        b.fields.properties['p-days'] = '9'
        b.fields.properties['p-amount'] = '9000'
        b.fields.properties['p-detail'] = JSON.stringify({u1: 100})
        b.fields.properties['p-done'] = JSON.stringify({from: IN_RANGE})

        const cards = [a, b]
        const flow = aggregatePersonFlow(board, cards, RANGE)
        const rows = aggregatePersonStats(board, cards, RANGE)
        const flowTotal = flow.reduce((acc, f) => acc + f.amount, 0)
        const rowsTotal = rows.reduce((acc, r) => acc + r.totalAmount, 0)
        expect(flowTotal).toBeCloseTo(rowsTotal)
        expect(flowTotal).toBeCloseTo(14000)
    })
})

describe('aggregatePivot', () => {
    function pivotCard(board: ReturnType<typeof buildBoard>, title: string, statusOpt: string, applyFrom: number | null): Card {
        const card = makeCard(board, {title})
        card.fields.properties['p-status'] = statusOpt
        card.fields.properties['p-days'] = '10'
        card.fields.properties['p-amount'] = '4000'
        card.fields.properties['p-detail'] = JSON.stringify({u1: 100})
        if (applyFrom !== null) {
            card.fields.properties['p-apply'] = JSON.stringify({from: applyFrom})
        }
        return card
    }

    test('按申请日期选卡、按状态分桶，不受汇总口径日期规则影响', () => {
        const board = buildBoard()
        const paid = pivotCard(board, '已付卡', 'o-paid', IN_RANGE)
        const done = pivotCard(board, '完成卡', 'o-done', IN_RANGE)
        const stale = pivotCard(board, '过期申请卡', 'o-paid', OUT_RANGE)

        const {rows, flow} = aggregatePivot(board, [paid, done, stale], RANGE, {
            datePropertyId: 'p-apply',
            statusValues: [],
        })
        expect(flow).toHaveLength(2)
        expect(rows).toHaveLength(1)
        // settled bucket from 已付款, completed bucket from 完成
        expect(rows[0].settledAmount).toBeCloseTo(4000)
        expect(rows[0].completedAmount).toBeCloseTo(4000)
        expect(rows[0].totalAmount).toBeCloseTo(8000)
    })

    test('带状态条件时只选命中状态的卡（申请且已付款口径）', () => {
        const board = buildBoard()
        const paid = pivotCard(board, '已付卡', 'o-paid', IN_RANGE)
        const done = pivotCard(board, '完成卡', 'o-done', IN_RANGE)

        const {flow} = aggregatePivot(board, [paid, done], RANGE, {
            datePropertyId: 'p-apply',
            statusValues: ['已付款'],
        })
        expect(flow).toHaveLength(1)
        expect(flow[0].cardTitle).toBe('已付卡')
    })

    test('无日期属性时返回空', () => {
        const board = buildBoard()
        const {rows, flow} = aggregatePivot(board, [], RANGE, {datePropertyId: undefined, statusValues: []})
        expect(rows).toHaveLength(0)
        expect(flow).toHaveLength(0)
    })
})
