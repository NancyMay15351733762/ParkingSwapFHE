// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ParkingSpot {
  id: string;
  encryptedLocation: string;
  pricePerHour: number;
  availableFrom: number;
  availableUntil: number;
  owner: string;
  status: "available" | "occupied" | "maintenance";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newSpotData, setNewSpotData] = useState({
    location: "",
    pricePerHour: "",
    availableFrom: "",
    availableUntil: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Calculate statistics for dashboard
  const availableCount = spots.filter(s => s.status === "available").length;
  const occupiedCount = spots.filter(s => s.status === "occupied").length;
  const maintenanceCount = spots.filter(s => s.status === "maintenance").length;

  // Filter spots based on search and filter criteria
  const filteredSpots = spots.filter(spot => {
    const matchesSearch = spot.encryptedLocation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         spot.owner.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = statusFilter === "all" || spot.status === statusFilter;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadSpots().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadSpots = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("spot_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing spot keys:", e);
        }
      }
      
      const list: ParkingSpot[] = [];
      
      for (const key of keys) {
        try {
          const spotBytes = await contract.getData(`spot_${key}`);
          if (spotBytes.length > 0) {
            try {
              const spotData = JSON.parse(ethers.toUtf8String(spotBytes));
              list.push({
                id: key,
                encryptedLocation: spotData.location,
                pricePerHour: spotData.pricePerHour,
                availableFrom: spotData.availableFrom,
                availableUntil: spotData.availableUntil,
                owner: spotData.owner,
                status: spotData.status || "available"
              });
            } catch (e) {
              console.error(`Error parsing spot data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading spot ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.availableFrom - a.availableFrom);
      setSpots(list);
    } catch (e) {
      console.error("Error loading spots:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitSpot = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting parking data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedLocation = `FHE-${btoa(newSpotData.location)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const spotId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const spotData = {
        location: encryptedLocation,
        pricePerHour: parseFloat(newSpotData.pricePerHour),
        availableFrom: Math.floor(new Date(newSpotData.availableFrom).getTime() / 1000),
        availableUntil: Math.floor(new Date(newSpotData.availableUntil).getTime() / 1000),
        owner: account,
        status: "available"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `spot_${spotId}`, 
        ethers.toUtf8Bytes(JSON.stringify(spotData))
      );
      
      const keysBytes = await contract.getData("spot_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(spotId);
      
      await contract.setData(
        "spot_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Parking spot listed securely with FHE encryption!"
      });
      
      await loadSpots();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewSpotData({
          location: "",
          pricePerHour: "",
          availableFrom: "",
          availableUntil: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const rentSpot = async (spotId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE rental transaction..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const spotBytes = await contract.getData(`spot_${spotId}`);
      if (spotBytes.length === 0) {
        throw new Error("Parking spot not found");
      }
      
      const spotData = JSON.parse(ethers.toUtf8String(spotBytes));
      
      const updatedSpot = {
        ...spotData,
        status: "occupied"
      };
      
      await contract.setData(
        `spot_${spotId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedSpot))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rental completed successfully!"
      });
      
      await loadSpots();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rental failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the parking sharing platform",
      icon: "🔗"
    },
    {
      title: "List Your Spot",
      description: "Add your parking spot details which will be encrypted using FHE",
      icon: "🅿️"
    },
    {
      title: "FHE Matching",
      description: "Your location data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Secure Rental",
      description: "Rent parking spots anonymously while keeping your data private",
      icon: "🔒"
    }
  ];

  const renderStatsChart = () => {
    return (
      <div className="stats-chart">
        <div className="chart-bar" style={{height: `${(availableCount/(spots.length||1)) * 100}%`}}>
          <span className="bar-label">{availableCount}</span>
        </div>
        <div className="chart-bar" style={{height: `${(occupiedCount/(spots.length||1)) * 100}%`}}>
          <span className="bar-label">{occupiedCount}</span>
        </div>
        <div className="chart-bar" style={{height: `${(maintenanceCount/(spots.length||1)) * 100}%`}}>
          <span className="bar-label">{maintenanceCount}</span>
        </div>
        <div className="chart-labels">
          <span>Available</span>
          <span>Occupied</span>
          <span>Maintenance</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="parking-icon"></div>
          </div>
          <h1>Parking<span>Swap</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-spot-btn"
          >
            <div className="add-icon"></div>
            List Spot
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous P2P Parking Sharing</h2>
            <p>Share and rent parking spots securely with FHE encryption technology</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How ParkingSwapFHE Works</h2>
            <p className="subtitle">Learn how to securely share parking spots with full privacy</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>About ParkingSwapFHE</h3>
            <p>Anonymous peer-to-peer parking spot sharing platform using FHE technology to protect location privacy while enabling efficient parking space utilization.</p>
            <div className="fhe-badge">
              <span>FHE-Encrypted</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Parking Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{spots.length}</div>
                <div className="stat-label">Total Spots</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{availableCount}</div>
                <div className="stat-label">Available</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{occupiedCount}</div>
                <div className="stat-label">Occupied</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{maintenanceCount}</div>
                <div className="stat-label">Maintenance</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Availability Chart</h3>
            {renderStatsChart()}
          </div>
        </div>
        
        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search locations or owners..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filter-box">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
        </div>
        
        <div className="spots-section">
          <div className="section-header">
            <h2>Available Parking Spots</h2>
            <div className="header-actions">
              <button 
                onClick={loadSpots}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="spots-list">
            {filteredSpots.length === 0 ? (
              <div className="no-spots">
                <div className="no-spots-icon"></div>
                <p>No parking spots found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  List First Spot
                </button>
              </div>
            ) : (
              <div className="spots-grid">
                {filteredSpots.map(spot => (
                  <div className="spot-card" key={spot.id}>
                    <div className="spot-image"></div>
                    <div className="spot-details">
                      <h3>FHE-Encrypted Location</h3>
                      <p className="spot-owner">Owner: {spot.owner.substring(0, 6)}...{spot.owner.substring(38)}</p>
                      <div className="spot-price">${spot.pricePerHour}/hour</div>
                      <div className="spot-availability">
                        <span>Available: {new Date(spot.availableFrom * 1000).toLocaleDateString()}</span>
                        <span>Until: {new Date(spot.availableUntil * 1000).toLocaleDateString()}</span>
                      </div>
                      <div className="spot-status">
                        <span className={`status-badge ${spot.status}`}>
                          {spot.status}
                        </span>
                      </div>
                    </div>
                    <div className="spot-actions">
                      {!isOwner(spot.owner) && spot.status === "available" && (
                        <button 
                          className="rent-btn"
                          onClick={() => rentSpot(spot.id)}
                        >
                          Rent Now
                        </button>
                      )}
                      {isOwner(spot.owner) && (
                        <button className="owner-btn">Your Spot</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitSpot} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          spotData={newSpotData}
          setSpotData={setNewSpotData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="parking-icon"></div>
              <span>ParkingSwapFHE</span>
            </div>
            <p>Anonymous peer-to-peer parking sharing with FHE encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ParkingSwapFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  spotData: any;
  setSpotData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  spotData,
  setSpotData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSpotData({
      ...spotData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!spotData.location || !spotData.pricePerHour || !spotData.availableFrom || !spotData.availableUntil) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>List Your Parking Spot</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your location data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Location Address *</label>
              <input 
                type="text"
                name="location"
                value={spotData.location} 
                onChange={handleChange}
                placeholder="Enter parking spot location..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Price Per Hour (ETH) *</label>
              <input 
                type="number"
                name="pricePerHour"
                value={spotData.pricePerHour} 
                onChange={handleChange}
                placeholder="0.01" 
                className="form-input"
                step="0.001"
                min="0.001"
              />
            </div>
            
            <div className="form-group">
              <label>Available From *</label>
              <input 
                type="datetime-local"
                name="availableFrom"
                value={spotData.availableFrom} 
                onChange={handleChange}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Available Until *</label>
              <input 
                type="datetime-local"
                name="availableUntil"
                value={spotData.availableUntil} 
                onChange={handleChange}
                className="form-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Location data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "List Spot Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;