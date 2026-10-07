import React from 'react'
import ReactDOM from 'react-dom/client'
import { ready } from '@site'
import App from './App'
import './index.css'

void ready.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
