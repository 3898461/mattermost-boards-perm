// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board, IPropertyTemplate} from './blocks/board'
import {Card} from './blocks/card'
import {TestBlockFactory} from './test/testBlockFactory'
import {buildHoursGateRequest} from './completionGate'
import {parseHoursDetail, sumHours, cardActualHours} from './actualHours'

function template(id: string, name: string, type: string, options: Array<{id: string, value: string}> = []): IPropertyTemplate {
    return {id, name, type, options: options.map((o) => ({...o, color: ''}))} as IPropertyTemplate
}

function makeBoardAndCard(hoursValue: string | undefined, detail?: Record<string, number>): {board: Board, card: Card} {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        template('p-status', '项目状态', 'select', [{id: 'opt-wip', value: '草图'}, {id: 'opt-done', value: '完成'}]),
        template('p-hours', '实际耗时', 'number'),
        template('p-hours-detail', '实际耗时明细', 'text'),
    ]
    const card = TestBlockFactory.createCard(board)
    card.title = '图标需求'
    card.fields.properties['p-status'] = 'opt-wip'
    if (hoursValue !== undefined) {
        card.fields.properties['p-hours'] = hoursValue
    }
    if (detail !== undefined) {
        card.fields.properties['p-hours-detail'] = JSON.stringify(detail)
    }
    return {board, card}
}

describe('hours detail helpers', () => {
    test('parse tolerates junk and sums numbers', () => {
        expect(parseHoursDetail('')).toEqual({})
        expect(parseHoursDetail('not json')).toEqual({})
        expect(parseHoursDetail('{"u1": 2.5, "u2": "3"}')).toEqual({u1: 2.5, u2: 3})
        expect(sumHours({u1: 2.5, u2: 3})).toBe(5.5)
        expect(sumHours({})).toBe(0)
    })

    test('card total prefers the number property, falls back to detail sum', () => {
        const withNumber = makeBoardAndCard('7', {u1: 2})
        expect(cardActualHours(withNumber.board, withNumber.card)).toBe(7)
        const detailOnly = makeBoardAndCard(undefined, {u1: 2, u2: 1.5})
        expect(cardActualHours(detailOnly.board, detailOnly.card)).toBe(3.5)
        const empty = makeBoardAndCard('')
        expect(cardActualHours(empty.board, empty.card)).toBe(0)
    })
})

describe('hours gate', () => {
    test('blocks entering 完成 with no hours, even for a single producer', () => {
        const {board, card} = makeBoardAndCard('')
        const req = buildHoursGateRequest(board, card, 'p-status', 'opt-done')
        expect(req).not.toBeNull()
        expect(req!.cardId).toBe(card.id)
    })

    test('passes when 实际耗时 is filled', () => {
        const {board, card} = makeBoardAndCard('6.5')
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })

    test('passes when only the detail exists and sums above zero', () => {
        const {board, card} = makeBoardAndCard(undefined, {u1: 4})
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })

    test('zero hours still blocks', () => {
        const {board, card} = makeBoardAndCard('0', {u1: 0})
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-done')).not.toBeNull()
    })

    test('other statuses never trigger; already in 完成 does not re-trigger', () => {
        const {board, card} = makeBoardAndCard('')
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-wip')).toBeNull()
        card.fields.properties['p-status'] = 'opt-done'
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })

    test('padded status option label still counts as 完成', () => {
        const {board, card} = makeBoardAndCard('')
        board.cardProperties[0].options[1].value = '完成 '
        expect(buildHoursGateRequest(board, card, 'p-status', 'opt-done')).not.toBeNull()
    })
})
