---
layout: post
title:  "026.Setup Rails Action Cable."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_026/realtime.gif
---
Đây là sample theo một video hướng dẫn của [Deanin trên Youtube](https://www.youtube.com/watch?v=GdbazkAczTo). Cho bạn một cái ví dụ đơn giản nhất về việc dùng actioncable để tạo tính năng real-time bằng Rails và Reactjs.

#### 1.Setup
```sh
rails g scaffold messages body:text
rails g channel messages
```
```ruby
# config/routes.rb

Rails.application.routes.draw do
  mount ActionCable.server => '/cable'
  resources :messages
end
```
```ruby
# app/channels/messages_channel.rb

class MessagesChannel < ApplicationCable::Channel
  def subscribed
    # stream_from "some_channel"
    stream_from "MessagesChannel"
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end
end
```
```ruby
# app/models/message.rb
class Message < ApplicationRecord
  after_create_commit { broadcast_message }

  private

  def broadcast_message
    ActionCable.server.broadcast('MessagesChannel', {
                                   id:,
                                   body:
                                 })
  end
end
```

#### 2.Client

```css
/* src/App.css */

#root {
  height: 100vh;
  width: 100%;
}

.messages {
  height: 60%;
  overflow-y: scroll;
  padding: 0 20px;

  margin: 10% auto 0 auto;
  width: 80%
}

.messageForm {
  height: 10%;
  width: 100%;
}

.messageInput {
  height: 40px;
  width: 80%;
}
.messageButton {
  height: 46px;
  width: 10%;
  border: 2px solid #4CAF50;
  padding: 1px 2px;
  background-color: #4CAF50;
  color: white;
  font-size: 16px;
  cursor: pointer;
  border-radius: 0px;
}

.messageHeader {
  height: 10%;
  width: 100%;
  text-align: center;
  padding: 10px;
}
```

```js
// src/App.jsx

import { useState, useEffect } from "react";
import "./App.css";

const ws = new WebSocket("ws://localhost:3000/cable");

function App() {
  const [messages, setMessages] = useState([]);
  const [guid, setGuid] = useState("");
  const messagesContainer = document.getElementById("messages");

  ws.onopen = () => {
    console.log("Connected to websocket server");
    setGuid(Math.random().toString(36).substring(2, 15));

    ws.send(
      JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({
          id: guid,
          channel: "MessagesChannel",
        }),
      })
    );
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "ping") return;
    if (data.type === "welcome") return;
    if (data.type === "confirm_subscription") return;

    const message = data.message;
    setMessagesAndScrollDown([...messages, message]);
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  useEffect(() => {
    resetScroll();
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const body = e.target.message.value;
    e.target.message.value = "";

    await fetch("http://localhost:3000/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
  };

  const fetchMessages = async () => {
    const response = await fetch("http://localhost:3000/messages");
    const data = await response.json();
    setMessagesAndScrollDown(data);
  };

  const setMessagesAndScrollDown = (data) => {
    setMessages(data);
    resetScroll();
  };

  const resetScroll = () => {
    if (!messagesContainer) return;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  return (
    <div className="App">
      <div className="messageHeader">
        <h1>Messages</h1>
        <p>Guid: {guid}</p>
      </div>
      <div className="messages" id="messages">
        {messages.map((message) => (
          <div className="message" key={message.id}>
            <p>{message.body}</p>
          </div>
        ))}
      </div>
      <div className="messageForm">
        <form onSubmit={handleSubmit}>
          <input className="messageInput" type="text" name="message" />
          <button className="messageButton" type="submit">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
```
