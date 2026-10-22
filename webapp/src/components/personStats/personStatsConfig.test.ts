// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createBoardView} from '../../blocks/boardView'
import {TestBlockFactory} from '../../test/testBlockFactory'

import {
    convertAmount,
    DEFAULT_INTERNAL_RATE,
    getPersonStatsConfig,
    groupOf,
    rateOf,
    resolvePivot,
    withGroup,
    withPivot,
    withRate,
} from './personStatsConfig'

describe('personStatsConfig', () => {
    test('无配置时组别为空、比例走默认 900', () => {
        const cfg = getPersonStatsConfig(createBoardView())
        expect(groupOf(cfg, 'u1')).toBe('')
        expect(rateOf(cfg, 'u1')).toBe(DEFAULT_INTERNAL_RATE)
        expect(convertAmount(cfg, 'u1', 9000)).toBe(10)
    })

    test('读视图已存配置', () => {
        const view = createBoardView()
        view.fields.personStatsConfig = {groups: {u1: '2D场景组'}, rates: {u1: 1000}}
        const cfg = getPersonStatsConfig(view)
        expect(groupOf(cfg, 'u1')).toBe('2D场景组')
        expect(rateOf(cfg, 'u1')).toBe(1000)
        expect(convertAmount(cfg, 'u1', 5000)).toBe(5)
    })

    test('withGroup/withRate 不可变更新，空值清除', () => {
        const cfg = getPersonStatsConfig(createBoardView())
        const c1 = withGroup(cfg, 'u1', '3D资产组')
        expect(groupOf(cfg, 'u1')).toBe('')
        expect(groupOf(c1, 'u1')).toBe('3D资产组')
        const c2 = withRate(c1, 'u1', 1200)
        expect(rateOf(c2, 'u1')).toBe(1200)
        const c3 = withGroup(c2, 'u1', '')
        expect(groupOf(c3, 'u1')).toBe('')
        const c4 = withRate(c3, 'u1', 0)
        expect(rateOf(c4, 'u1')).toBe(DEFAULT_INTERNAL_RATE)
    })
})

describe('pivot definitions', () => {
    const boardWithProps = (names: string[]) => {
        const board = TestBlockFactory.createBoard()
        board.cardProperties = names.map((name, i) => ({
            id: 'prop-' + i,
            name,
            type: 'date' as const,
            options: [],
        }))
        return board
    }

    test('默认按属性名解析，实际完成在缺完成日期时回退到期时间', () => {
        const cfg = getPersonStatsConfig(createBoardView())
        const board = boardWithProps(['申请日期', '到期时间', '结算日期'])
        expect(resolvePivot(cfg, board, 'apply').datePropertyName).toBe('申请日期')
        expect(resolvePivot(cfg, board, 'done').datePropertyName).toBe('到期时间')
        expect(resolvePivot(cfg, board, 'clientSettle').datePropertyName).toBe('结算日期')
        expect(resolvePivot(cfg, board, 'appliedPaid').statusValues).toEqual(['已付款'])
        expect(resolvePivot(cfg, board, 'apply').statusValues).toEqual([])
    })

    test('已存配置优先：日期属性按 ID、状态条件按存值', () => {
        const board = boardWithProps(['申请日期', '结算日期'])
        let cfg = getPersonStatsConfig(createBoardView())
        cfg = withPivot(cfg, 'apply', {datePropertyId: 'prop-1', statusValues: ['待付款']})
        const def = resolvePivot(cfg, board, 'apply')
        expect(def.datePropertyId).toBe('prop-1')
        expect(def.datePropertyName).toBe('结算日期')
        expect(def.statusValues).toEqual(['待付款'])
    })

    test('board 上找不到任何候选日期属性时 datePropertyId 为空', () => {
        const cfg = getPersonStatsConfig(createBoardView())
        const board = boardWithProps(['别的日期'])
        expect(resolvePivot(cfg, board, 'apply').datePropertyId).toBeUndefined()
    })
})
