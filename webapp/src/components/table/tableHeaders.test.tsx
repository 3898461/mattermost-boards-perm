// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import React from 'react'
import {render} from '@testing-library/react'
import '@testing-library/jest-dom'
import {Provider as ReduxProvider} from 'react-redux'
import configureStore from 'redux-mock-store'

import 'isomorphic-fetch'
import {wrapDNDIntl} from '../../testUtils'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {ColumnResizeProvider} from './tableColumnResizeContext'
import TableHeaders from './tableHeaders'

describe('components/table/TableHeaders', () => {
    const board = TestBlockFactory.createBoard()
    const card = TestBlockFactory.createCard(board)
    const view = TestBlockFactory.createBoardView(board)

    const state = {
        users: {
            me: {
                id: 'user_id_1',
            },
            boardUsers: {},
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            boards: {
                [board.id]: board,
            },
            current: board.id,
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
    }

    const mockStore = configureStore([])

    test('should match snapshot', async () => {
        const store = mockStore(state)
        const component = wrapDNDIntl(
            <ReduxProvider store={store}>
                <ColumnResizeProvider
                    columnWidths={{}}
                    onResizeColumn={() => {}}
                >
                    <TableHeaders
                        board={board}
                        cards={[card]}
                        activeView={view}
                        views={[view]}
                        readonly={false}
                    />
                </ColumnResizeProvider>
            </ReduxProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
