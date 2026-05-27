"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import { GoogleMap, Marker, LoadScript } from "@react-google-maps/api";
import { db } from "@/lib/firebase";

const GOOGLE_MAPS_API_KEY = "AIzaSyCb7QdIbcoMXKlB7eA-ZKFhuubJzbyF0Fs";
const libraries = ["places"];

const PARTY_LOCATION = {
  lat: 48.7483,
  lng: 8.2378,
  address: "Klostergut Fremersberg, 76530 Baden-Baden",
};

const mapContainerStyle = {
  width: "100%",
  height: "400px",
};

function getGuests(ride) {
  if (Array.isArray(ride.guests)) return ride.guests;
  if (ride.guest) return [ride.guest];
  return [];
}

export default function FahrerPage() {
  const [driverName, setDriverName] = useState("");
  const [savedDriverName, setSavedDriverName] = useState("");
  const [rides, setRides] = useState([]);
  const [driverLocation, setDriverLocation] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "rides"), orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesData = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      setRides(ridesData);
    });

    return () => unsubscribe();
  }, []);

  async function startLocationTracking() {
    if (!savedDriverName) {
      alert("Bitte zuerst deinen Namen eingeben.");
      return;
    }

    if (!navigator.geolocation) {
      alert("Standort wird von deinem Gerät nicht unterstützt.");
      return;
    }

    navigator.geolocation.watchPosition(
      async (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setDriverLocation(location);

        await setDoc(doc(db, "drivers", savedDriverName), {
          name: savedDriverName,
          location,
          updatedAt: Date.now(),
        });
      },
      (error) => {
        console.error(error);
        alert("Standortfreigabe wurde blockiert oder ist fehlgeschlagen.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );
  }

  async function takeRide(rideId) {
    if (!savedDriverName) {
      alert("Bitte zuerst deinen Namen eingeben.");
      return;
    }

    await updateDoc(doc(db, "rides", rideId), {
      status: "assigned",
      assignedDriver: savedDriverName,
    });
  }

  async function completeRide(rideId) {
    await updateDoc(doc(db, "rides", rideId), {
      status: "done",
      completedAt: Date.now(),
    });

    const nextOpenRide = rides.find((ride) => ride.status === "open");

    if (nextOpenRide) {
      await updateDoc(doc(db, "rides", nextOpenRide.id), {
        status: "assigned",
        assignedDriver: savedDriverName,
      });
    }
  }

  function openNavigation(address) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      address
    )}`;
    window.open(url, "_blank");
  }

  const currentRide = rides.find(
    (ride) =>
      ride.status === "assigned" &&
      ride.assignedDriver === savedDriverName
  );

  const openRides = rides.filter((ride) => ride.status === "open");
  const doneRides = rides.filter((ride) => ride.status === "done");

  const guestMarkers = rides
    .filter((ride) => ride.status !== "done")
    .flatMap((ride) =>
      getGuests(ride)
        .filter((guest) => guest.location)
        .map((guest, index) => ({
          id: `${ride.id}-${index}`,
          rideNumber: ride.rideNumber,
          name: guest.name,
          location: guest.location,
        }))
    );

  return (
    <main className="min-h-screen bg-gray-100 p-6 text-black">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <h1 className="text-3xl font-bold mb-4">Fahrer / Admin</h1>

          {!savedDriverName ? (
            <div className="space-y-3">
              <input
                className="w-full border p-3 rounded-xl text-black placeholder-gray-500"
                placeholder="Dein Name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />

              <button
                className="w-full bg-black text-white p-3 rounded-xl"
                onClick={() => setSavedDriverName(driverName)}
              >
                Starten
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p>
                Angemeldet als: <strong>{savedDriverName}</strong>
              </p>

              <button
                className="w-full bg-blue-600 text-white p-3 rounded-xl"
                onClick={startLocationTracking}
              >
                Standort teilen starten
              </button>
            </div>
          )}
        </div>

        {savedDriverName && (
          <>
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Live-Karte</h2>

              <LoadScript
                googleMapsApiKey={GOOGLE_MAPS_API_KEY}
                libraries={libraries}
              >
                <GoogleMap
                  mapContainerStyle={mapContainerStyle}
                  center={driverLocation || PARTY_LOCATION}
                  zoom={13}
                >
                  <Marker position={PARTY_LOCATION} label="Fest" />

                  {driverLocation && (
                    <Marker position={driverLocation} label="Ich" />
                  )}

                  {guestMarkers.map((guest) => (
                    <Marker
                      key={guest.id}
                      position={guest.location}
                      label={guest.rideNumber}
                    />
                  ))}
                </GoogleMap>
              </LoadScript>
            </div>

            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Aktuelle Fahrt</h2>

              {currentRide ? (
                <div className="border rounded-xl p-4 space-y-3">
                  <p>
                    <strong>{currentRide.rideNumber}</strong>
                  </p>

                  <p>
                    Personen: <strong>{getGuests(currentRide).length}</strong>
                  </p>

                  <div className="space-y-2">
                    {getGuests(currentRide).map((guest, index) => (
                      <div key={index} className="border rounded-xl p-3">
                        <p>
                          <strong>{index + 1}. {guest.name}</strong>
                        </p>
                        <p>{guest.address}</p>

                        <button
                          className="w-full bg-blue-600 text-white p-2 rounded-xl mt-2"
                          onClick={() => openNavigation(guest.address)}
                        >
                          Zu dieser Adresse navigieren
                        </button>
                      </div>
                    ))}
                  </div>

                  <p>
                    Fahrzeit einfach: ca.{" "}
                    {currentRide.oneWayMinutes || "?"} Minuten
                  </p>

                  <button
                    className="w-full bg-green-600 text-white p-3 rounded-xl mt-3"
                    onClick={() => completeRide(currentRide.id)}
                  >
                    Fahrt erledigt
                  </button>
                </div>
              ) : (
                <p>Du hast aktuell keine Fahrt.</p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Warteschlange</h2>

              {openRides.length === 0 ? (
                <p>Keine offenen Fahrten.</p>
              ) : (
                <div className="space-y-3">
                  {openRides.map((ride) => (
                    <div key={ride.id} className="border rounded-xl p-4">
                      <p>
                        <strong>{ride.rideNumber}</strong>
                      </p>

                      <p>
                        Personen: <strong>{getGuests(ride).length}</strong>
                      </p>

                      <div className="mt-2 space-y-1">
                        {getGuests(ride).map((guest, index) => (
                          <p key={index}>
                            {index + 1}. {guest.name} — {guest.address}
                          </p>
                        ))}
                      </div>

                      <p className="mt-2">
                        Wartezeit: ca.{" "}
                        {ride.estimatedWaitingMinutes || "?"} Minuten
                      </p>

                      <button
                        className="w-full bg-black text-white p-3 rounded-xl mt-3"
                        onClick={() => takeRide(ride.id)}
                      >
                        Fahrt übernehmen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Erledigte Fahrten</h2>

              {doneRides.length === 0 ? (
                <p>Noch keine erledigten Fahrten.</p>
              ) : (
                <div className="space-y-2">
                  {doneRides.map((ride) => (
                    <div key={ride.id} className="border rounded-xl p-3">
                      <strong>{ride.rideNumber}</strong> —{" "}
                      {getGuests(ride).map((guest) => guest.name).join(", ")}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}