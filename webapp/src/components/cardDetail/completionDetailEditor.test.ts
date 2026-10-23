// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {splitEvenly, producerColor, PRODUCER_COLORS} from './completionDetailEditor'

describe('completionDetailEditor helpers', () => {
    it('splitEvenly always sums to exactly 100', () => {
        for (let n = 1; n <= 6; n++) {
            const ids = Array.from({length: n}, (_, i) => `u${i}`)
            const split = splitEvenly(ids)
            const sum = Object.values(split).reduce((acc, v) => acc + parseFloat(v), 0)
            expect(Math.round(sum * 100) / 100).toBe(100)
            expect(Object.keys(split)).toHaveLength(n)
        }
    })

    it('splitEvenly for two producers is 50:50', () => {
        expect(splitEvenly(['a', 'b'])).toEqual({a: '50', b: '50'})
    })

    it('splitEvenly for one producer is 100', () => {
        expect(splitEvenly(['a'])).toEqual({a: '100'})
    })

    it('producerColor cycles through the palette', () => {
        expect(producerColor(0)).toBe(PRODUCER_COLORS[0])
        expect(producerColor(PRODUCER_COLORS.length)).toBe(PRODUCER_COLORS[0])
    })
})
