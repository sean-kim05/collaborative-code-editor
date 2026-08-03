/**
 * App shell — two routes, no auth.
 *
 * `/` is the landing page and `/room/:roomId` is a session; the room id in the
 * URL is the only identifier the app needs, which is what makes "paste a link
 * to collaborate" work with no account system behind it.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RoomProvider } from './context/RoomContext';
import Home from './pages/Home';
import Room from './pages/Room';

export default function App() {
  return (
    <RoomProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
        </Routes>
      </BrowserRouter>
    </RoomProvider>
  );
}
