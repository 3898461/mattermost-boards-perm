// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board, IPropertyTemplate} from './blocks/board'
import {Card} from './blocks/card'
import {TestBlockFactory} from './test/testBlockFactory'
import {buildCompletionRequest} from './completionGate'
import {requestCompletionConfirmation, registerCompletionConfirmHandler} from './completionConfirm'

function template(id: string, name: string, type: string, options: Array<{id: string, value: string}> = []): IPropertyTemplate {
    return {id, name, type, options: options.map((o) => ({...o, color: ''}))} as IPropertyTemplate
}

function makeBoardAndCard(producerIds: string[], detail: Record<string, number>): {board: Board, card: Card} {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        template('p-status', '项目状态', 'select', [{id: 'opt-wip', value: '草图'}, {id: 'opt-done', value: '完成'}]),
        template('p-producers', '制作人', 'multiPerson'),
        template('p-detail', '完成度明细', 'text'),
        template('p-total', '总完成度', 'number'),
        template('p-days', '人天', 'number'),
        template('p-amount', '实际金额', 'number'),
    ]
    const card = TestBlockFactory.createCard(board)
    card.title = '图标需求'
    card.fields.properties['p-status'] = 'opt-wip'
    card.fields.properties['p-producers'] = producerIds
    card.fields.properties['p-detail'] = JSON.stringify(detail)
    card.fields.properties['p-days'] = '10'
    card.fields.properties['p-amount'] = '9000'
    return {board, card}
}

describe('completion gate', () => {
    test('single producer passes without confirmation', () => {
        const {board, card} = makeBoardAndCard(['u1'], {u1: 100})
        expect(buildCompletionRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })

    test('no producers passes without confirmation', () => {
        const {board, card} = makeBoardAndCard([], {})
        expect(buildCompletionRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })

    test('two producers moving into 完成 need confirmation with share-only rows', () => {
        const {board, card} = makeBoardAndCard(['u1', 'u2'], {u1: 20, u2: 80})
        const req = buildCompletionRequest(board, card, 'p-status', 'opt-done')
        expect(req).not.toBeNull()
        expect(req!.totalShare).toBe(100)
        expect(req!.rows).toEqual([
            {userId: 'u1', share: 20},
            {userId: 'u2', share: 80},
        ])
        expect(req!.detailPropertyId).toBe('p-detail')
        expect(req!.totalPropertyId).toBe('p-total')
    })

    test('other statuses and non-status properties never trigger', () => {
        const {board, card} = makeBoardAndCard(['u1', 'u2'], {u1: 50, u2: 50})
        expect(buildCompletionRequest(board, card, 'p-status', 'opt-wip')).toBeNull()
        expect(buildCompletionRequest(board, card, 'p-days', 'opt-done')).toBeNull()
    })

    test('already in 完成 does not re-trigger', () => {
        const {board, card} = makeBoardAndCard(['u1', 'u2'], {u1: 50, u2: 50})
        card.fields.properties['p-status'] = 'opt-done'
        expect(buildCompletionRequest(board, card, 'p-status', 'opt-done')).toBeNull()
    })
})

describe('completionConfirm registry', () => {
    test('defaults to confirmed when no host is registered', async () => {
        await expect(requestCompletionConfirmation({cardTitle: 'x', rows: [], totalShare: 0})).resolves.toEqual({confirmed: true})
    })

    test('propagates the host decision (incl. edited shares) and unregisters cleanly', async () => {
        const unregister = registerCompletionConfirmHandler(async () => ({confirmed: false, shares: {u1: 30, u2: 70}}))
        await expect(requestCompletionConfirmation({cardTitle: 'x', rows: [], totalShare: 0})).
            resolves.toEqual({confirmed: false, shares: {u1: 30, u2: 70}})
        unregister()
        await expect(requestCompletionConfirmation({cardTitle: 'x', rows: [], totalShare: 0})).resolves.toEqual({confirmed: true})
    })
})
