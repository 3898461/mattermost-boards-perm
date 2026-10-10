// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'
import {Provider as ReduxProvider} from 'react-redux'

import {render} from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import configureStore from 'redux-mock-store'

import {wrapIntl} from '../testUtils'

import MemberVisibilityList from './memberVisibilityList'

describe('components/memberVisibilityList', () => {
    const mockStore = configureStore([])

    const adminUser = {
        id: 'user-admin',
        username: 'admin',
        nickname: '',
        firstname: '',
        lastname: '',
        email: 'admin@example.com',
        props: {},
        create_at: 1,
        update_at: 1,
        delete_at: 0,
    }
    const member1 = {...adminUser, id: 'user-1', username: 'member1', email: 'member1@example.com'}
    const member2 = {...adminUser, id: 'user-2', username: 'member2', email: 'member2@example.com'}

    const state = {
        users: {
            me: adminUser,
            boardUsers: {
                'user-admin': adminUser,
                'user-1': member1,
                'user-2': member2,
            },
        },
        boards: {
            current: 'board-1',
            membersInBoards: {
                'board-1': {
                    'user-admin': {boardId: 'board-1', userId: 'user-admin', schemeAdmin: true, schemeEditor: true, schemeCommenter: false, schemeViewer: false},
                    'user-1': {boardId: 'board-1', userId: 'user-1', schemeAdmin: false, schemeEditor: true, schemeCommenter: false, schemeViewer: false},
                    'user-2': {boardId: 'board-1', userId: 'user-2', schemeAdmin: false, schemeEditor: true, schemeCommenter: false, schemeViewer: false},
                },
            },
        },
        clientConfig: {
            value: {
                teammateNameDisplay: 'username',
            },
        },
    }

    test('admin is checked and locked, others unchecked when restricted', () => {
        const store = mockStore(state)
        const component = wrapIntl(
            <ReduxProvider store={store}>
                <MemberVisibilityList
                    restrictedUserIDs={['user-admin']}
                    onChange={jest.fn()}
                />
            </ReduxProvider>,
        )
        const {getByLabelText} = render(component)

        const adminBox = getByLabelText(/admin/) as HTMLInputElement
        expect(adminBox.checked).toBe(true)
        expect(adminBox.disabled).toBe(true)

        const m1Box = getByLabelText('member1') as HTMLInputElement
        expect(m1Box.checked).toBe(false)
        expect(m1Box.disabled).toBe(false)
    })

    test('everyone checked when unrestricted', () => {
        const store = mockStore(state)
        const component = wrapIntl(
            <ReduxProvider store={store}>
                <MemberVisibilityList
                    restrictedUserIDs={undefined}
                    onChange={jest.fn()}
                />
            </ReduxProvider>,
        )
        const {getByLabelText} = render(component)

        expect((getByLabelText(/admin/) as HTMLInputElement).checked).toBe(true)
        expect((getByLabelText('member1') as HTMLInputElement).checked).toBe(true)
        expect((getByLabelText('member2') as HTMLInputElement).checked).toBe(true)
    })

    test('checking a member keeps admins in the list', async () => {
        const store = mockStore(state)
        const onChange = jest.fn()
        const component = wrapIntl(
            <ReduxProvider store={store}>
                <MemberVisibilityList
                    restrictedUserIDs={['user-admin']}
                    onChange={onChange}
                />
            </ReduxProvider>,
        )
        const {getByLabelText} = render(component)

        await userEvent.click(getByLabelText('member1'))
        expect(onChange).toHaveBeenCalledTimes(1)
        const ids = onChange.mock.calls[0][0] as string[]
        expect(ids).toContain('user-admin')
        expect(ids).toContain('user-1')
    })

    test('unchecking the last member leaves only admins', async () => {
        const store = mockStore(state)
        const onChange = jest.fn()
        const component = wrapIntl(
            <ReduxProvider store={store}>
                <MemberVisibilityList
                    restrictedUserIDs={['user-admin', 'user-1']}
                    onChange={onChange}
                />
            </ReduxProvider>,
        )
        const {getByLabelText} = render(component)

        await userEvent.click(getByLabelText('member1'))
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange.mock.calls[0][0]).toEqual(['user-admin'])
    })

    test('checking everyone back normalizes to visible-to-everyone', async () => {
        const store = mockStore(state)
        const onChange = jest.fn()
        const component = wrapIntl(
            <ReduxProvider store={store}>
                <MemberVisibilityList
                    restrictedUserIDs={['user-admin', 'user-1']}
                    onChange={onChange}
                />
            </ReduxProvider>,
        )
        const {getByLabelText} = render(component)

        await userEvent.click(getByLabelText('member2'))
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange.mock.calls[0][0]).toBeUndefined()
    })
})
