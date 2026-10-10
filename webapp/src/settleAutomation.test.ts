// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board} from './blocks/board'
import {
    findTemplateByName,
    isAutoManagedProperty,
    parseTrailingNumber,
    SETTLE_PROP_NAMES,
} from './settleAutomation'
import {TestBlockFactory} from './test/testBlockFactory'

describe('settleAutomation pure helpers', () => {
    test('parseTrailingNumber extracts trailing digits', () => {
        expect(parseTrailingNumber('客户A图标1000')).toBe(1000)
        expect(parseTrailingNumber('客户B界面950')).toBe(950)
        expect(parseTrailingNumber('单价 1200.5')).toBe(1200.5)
        expect(parseTrailingNumber('客户A图标一千')).toBeUndefined()
        expect(parseTrailingNumber('')).toBeUndefined()
        expect(parseTrailingNumber('1000 客户A图标')).toBeUndefined()
    })

    test('isAutoManagedProperty gates computed fields only', () => {
        expect(isAutoManagedProperty(SETTLE_PROP_NAMES.unitPrice)).toBe(true)
        expect(isAutoManagedProperty(SETTLE_PROP_NAMES.amount)).toBe(true)
        expect(isAutoManagedProperty('总完成度')).toBe(true)
        expect(isAutoManagedProperty(SETTLE_PROP_NAMES.personDays)).toBe(false)
        expect(isAutoManagedProperty(SETTLE_PROP_NAMES.unitPriceSelect)).toBe(false)
        expect(isAutoManagedProperty(undefined)).toBe(false)
        expect(isAutoManagedProperty('')).toBe(false)
    })

    test('findTemplateByName matches exact property names', () => {
        const board: Board = TestBlockFactory.createBoard()
        expect(findTemplateByName(board, '人天')).toBeUndefined()
        board.cardProperties.push({
            id: 'prop-1',
            name: '人天',
            type: 'number',
            options: [],
        })
        expect(findTemplateByName(board, '人天')?.id).toBe('prop-1')
        expect(findTemplateByName(board, '人 天')).toBeUndefined()
    })
})
