// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {parseCardDate, selectArchiveCandidates} from './archiveModal'

function template(id: string, name: string, type: string, options: Array<{id: string, value: string}> = []): IPropertyTemplate {
    return {id, name, type, options: options.map((o) => ({...o, color: ''}))} as IPropertyTemplate
}

function makeBoard(): Board {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        template('p-status', '项目状态', 'select', [{id: 'opt-wip', value: '草图'}, {id: 'opt-paid', value: '已付款'}]),
        template('p-amount', '实际金额', 'number'),
        template('p-paid-date', '付款日期', 'date'),
    ]
    return board
}

function makeCard(board: Board, status: string, amount: string, paidAt?: number): Card {
    const card = TestBlockFactory.createCard(board)
    card.fields.properties['p-status'] = status
    card.fields.properties['p-amount'] = amount
    if (paidAt !== undefined) {
        card.fields.properties['p-paid-date'] = String(paidAt)
    }
    return card
}

describe('archive candidates', () => {
    const june2026 = new Date(2026, 5, 15).getTime()
    const aug2026 = new Date(2026, 7, 15).getTime()

    test('only 已付款 cards are eligible, amounts summed by caller', () => {
        const board = makeBoard()
        const cards = [
            makeCard(board, 'opt-paid', '1000', june2026),
            makeCard(board, 'opt-wip', '2000', june2026),
        ]
        const out = selectArchiveCandidates(board, cards, '')
        expect(out).toHaveLength(1)
        expect(out[0].amount).toBe(1000)
    })

    test('cutoff month excludes later payments and cards without a payment date', () => {
        const board = makeBoard()
        const cards = [
            makeCard(board, 'opt-paid', '1000', june2026),
            makeCard(board, 'opt-paid', '2000', aug2026),
            makeCard(board, 'opt-paid', '3000'),
        ]
        const out = selectArchiveCandidates(board, cards, '2026-06')
        expect(out).toHaveLength(1)
        expect(out[0].amount).toBe(1000)
    })

    test('parseCardDate handles ms strings and {from} objects', () => {
        expect(parseCardDate('12345')).toBe(12345)
        expect(parseCardDate({from: 999})).toBe(999)
        expect(parseCardDate('')).toBeUndefined()
        expect(parseCardDate(undefined)).toBeUndefined()
    })
})
