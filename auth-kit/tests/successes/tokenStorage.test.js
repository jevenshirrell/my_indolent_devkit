'use strict'

// Tests storing, getting, and clearing a user token

const createAuth = require('../../../auth-kit')


const auth = createAuth('secret', {timer:'1h', saltRounds:9})

// fake storage used to act as browser localStorage
let storage = () => {
    let store = {}

    return {
        getItem(key) {
            return key in store ? store[key] : null
        },
        setItem(key, val) {
            store[key] = val
        },
        removeItem(key) {
            delete store[key]
        }
    }
}
const tokenStorage = auth.createTokenStorage({storage:storage()})

let user = { name:'test', id:'12345' }
let token = auth.signToken(user)


tokenStorage.setToken(token)
console.log(tokenStorage.getToken())
tokenStorage.clearToken()
console.log(tokenStorage.getToken())
