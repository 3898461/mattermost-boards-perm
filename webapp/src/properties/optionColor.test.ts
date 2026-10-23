// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {TestBlockFactory} from '../test/testBlockFactory'
import {IPropertyOption, IPropertyTemplate} from '../blocks/board'

import {optionFamilySeed, pickOptionColor, sortOptionsByFamily} from './optionColor'

function template(id: string, name: string, options: Array<{id: string, value: string, color?: string}> = []): IPropertyTemplate {
    return {
        id,
        name,
        type: 'select',
        options: options.map((o) => ({id: o.id, value: o.value, color: o.color || 'propColorDefault'})),
    } as IPropertyTemplate
}

function buildBoard(priceOptions: Array<{id: string, value: string, color?: string}> = []) {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        template('p-client', '甲方', [
            {id: 'c-nw', value: '网易'},
            {id: 'c-ls', value: '莉莉丝'},
            {id: 'c-yk', value: '游卡'},
        ]),
        template('p-price', '实际单价', priceOptions),
    ]
    return board
}

describe('optionFamilySeed', () => {
    test('甲方前缀决定家族', () => {
        const board = buildBoard()
        expect(optionFamilySeed(board, '网易雷火图标900')).toBe('网易')
        expect(optionFamilySeed(board, '网易艺设界面850')).toBe('网易')
        expect(optionFamilySeed(board, '莉莉丝图标1000')).toBe('莉莉丝')
    })

    test('无甲方匹配时去掉尾数价格', () => {
        const board = buildBoard()
        expect(optionFamilySeed(board, '米哈游图标1000')).toBe('米哈游图标')
        expect(optionFamilySeed(board, '登纸2D原画1200')).toBe('登纸2D原画')
    })
})

describe('pickOptionColor', () => {
    test('同甲方同色、异甲方不同色（调色板足够时）', () => {
        const board = buildBoard()
        const price = board.cardProperties.find((p) => p.id === 'p-price')!
        const c1 = pickOptionColor(board, price, '网易雷火图标900')
        expect(c1).not.toBe('propColorDefault')
        // family color is derived from the client alone: any 网易 label agrees
        expect(pickOptionColor(board, price, '网易艺设界面850')).toBe(c1)
    })

    test('家族已有颜色时复用（哪怕是手工配的）', () => {
        const board = buildBoard([
            {id: 'o1', value: '网易雷火图标900', color: 'propColorPink'},
        ])
        const price = board.cardProperties.find((p) => p.id === 'p-price')!
        expect(pickOptionColor(board, price, '网易雷火界面850')).toBe('propColorPink')
    })

    test('新家族避开其他家族已占用的颜色', () => {
        const board = buildBoard()
        const price = board.cardProperties.find((p) => p.id === 'p-price')!
        const used = new Set<string>()
        for (const label of ['网易雷火图标900', '莉莉丝图标1000', '游卡1000', '创梦天地图标900', '米哈游图标1000', '沐瞳图标800', '元点互动图标1000', '登纸2D原画1200']) {
            const color = pickOptionColor(board, {...price, options: [...price.options, ...Array.from(used).map((c, i) => ({id: `x${i}`, value: `占位${i}`, color: c}))]}, label)
            used.add(color)
        }
        expect(used.size).toBeGreaterThanOrEqual(5)
        expect(used.has('propColorDefault')).toBe(false)
    })
})

describe('sortOptionsByFamily', () => {
    test('同甲方标签相邻成组，家族保持首次出现顺序，组内按标签排', () => {
        const board = buildBoard()
        const opts = [
            {id: '1', value: '网易雷火图标900', color: ''},
            {id: '2', value: '游卡1000', color: ''},
            {id: '3', value: '网易艺设图标900', color: ''},
            {id: '4', value: '莉莉丝图标1000', color: ''},
            {id: '5', value: '网易雷火界面850', color: ''},
            {id: '6', value: '网易雷火角色原画897', color: ''},
        ] as IPropertyOption[]
        const sorted = sortOptionsByFamily(board, opts).map((o) => o.value)
        // 网易 family first (first appearance), internally alphabetical
        expect(sorted.slice(0, 4)).toEqual(['网易雷火角色原画897', '网易雷火界面850', '网易雷火图标900', '网易艺设图标900'])
        expect(sorted.slice(4)).toEqual(['游卡1000', '莉莉丝图标1000'])
        // stored order untouched
        expect(opts.map((o) => o.value)).toEqual(['网易雷火图标900', '游卡1000', '网易艺设图标900', '莉莉丝图标1000', '网易雷火界面850', '网易雷火角色原画897'])
    })
})
